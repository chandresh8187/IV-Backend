const db = require("../config/db");
const { hasPermission } = require("../services/permissionService");
const { ensureAutomaticShift } = require("../services/automaticShiftService");
const { getPlantStatusRow } = require("./plantStatusController");
const {
  checkEntryZincNotification,
} = require("../utils/checkEntryZincNotification");

const notifyZincSafely = async ({
  entryId,
  entrySnapshot,
  io,
  retryIfAlreadySent = false,
}) => {
  try {
    const result = await checkEntryZincNotification({
      entryId,
      entrySnapshot,
      io,
      retryIfAlreadySent,
    });
    console.info("Production zinc notification check:", {
      entry_id: entryId,
      ...result,
    });
    return result;
  } catch (error) {
    console.error("Zinc notification failed:", error);
    return {
      triggered: false,
      reason: "NOTIFICATION_CHECK_FAILED",
    };
  }
};

const consumeEditGrant = async (queryable, grantId) => {
  if (!grantId) return;

  await queryable.query(
    "UPDATE production_edit_grants SET used_at = NOW() WHERE id = ? AND used_at IS NULL",
    [grantId],
  );
};
const calculateZincPercentage = (msWeight, giWeight) => {
  const ms = Number(msWeight);
  const gi = Number(giWeight);

  if (!ms || ms <= 0 || !gi || gi <= 0) return null;

  return (((gi - ms) / ms) * 100).toFixed(2);
};

const calculateProductionWeight = (dippingQty, msWeight) => {
  const qty = Number(dippingQty);
  const ms = Number(msWeight);

  if (!qty || qty <= 0 || !ms || ms <= 0) return 0;

  return (qty * ms).toFixed(3);
};

const calculateAvgCoating = (readings) => {
  const values = readings
    .map(Number)
    .filter((value) => !isNaN(value) && value > 0);

  if (values.length === 0) return null;

  const total = values.reduce((sum, value) => sum + value, 0);

  return Math.round(total / values.length);
};

const getActiveShift = async () => {
  return ensureAutomaticShift();
};

const saveProductionEntry = async (req, res) => {
  try {
    const {
      entry_type,
      planning_id,
      client_request_id,
      offline_shift_id,
      sr_no,

      challan_no,
      party_name,
      material,

      production_time,
      dipping_qty,
      kettle_temperature,

      ms_weight,
      gi_weight,

      c1,
      c2,
      c3,
      c4,
      c5,
    } = req.body;

    if (!entry_type) {
      return res.status(400).json({
        success: false,
        message: "entry_type is required",
      });
    }

    if (!["basic", "dip", "weight", "coating", "full"].includes(entry_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid entry_type",
      });
    }

    const serialNumber = Number(sr_no);

    if (!Number.isInteger(serialNumber) || serialNumber < 1) {
      return res.status(400).json({
        success: false,
        message: "sr_no must be a positive whole number",
      });
    }

    const clientRequestId = String(client_request_id || "").trim() || null;
    if (clientRequestId && !/^[A-Za-z0-9:_-]{8,64}$/.test(clientRequestId)) {
      return res.status(400).json({
        success: false,
        message: "client_request_id must be 8-64 safe characters",
      });
    }

    if (clientRequestId) {
      const [replayed] = await db.query(
        `SELECT id, sr_no, zinc_percentage, production_weight, avg_coating
         FROM production_entries WHERE client_request_id = ? LIMIT 1`,
        [clientRequestId],
      );
      if (replayed.length) {
        return res.json({
          success: true,
          action: "replayed",
          message: "Offline production entry was already synchronized",
          data: { production_id: replayed[0].id, ...replayed[0] },
        });
      }
    }

    const io = req.app.get("io");

    const offlineShiftId = Number(offline_shift_id);
    const hasOfflineShift = clientRequestId && Number.isInteger(offlineShiftId) && offlineShiftId > 0;
    const plantStatus = await getPlantStatusRow();

    if (!plantStatus) {
      return res.status(500).json({
        success: false,
        message: "Plant status configuration not found",
      });
    }

    if (plantStatus.status !== "running" && !hasOfflineShift) {
      return res.status(423).json({
        success: false,
        code:
          plantStatus.status === "maintenance"
            ? "PLANT_UNDER_MAINTENANCE"
            : "PLANT_STOPPED",
        message:
          plantStatus.message || "Production entry is temporarily unavailable",
        data: {
          plant_status: plantStatus.status,
          title: plantStatus.title,
          expected_restart_at: plantStatus.expected_restart_at,
        },
      });
    }

    let activeShift = await getActiveShift();
    if (hasOfflineShift) {
      const [offlineShifts] = await db.query(
        `SELECT * FROM shifts WHERE id=?
         AND shift_date >= CURDATE() - INTERVAL 7 DAY
         LIMIT 1`,
        [offlineShiftId],
      );
      if (!offlineShifts.length) {
        return res.status(409).json({
          success: false,
          code: "OFFLINE_SHIFT_EXPIRED",
          message: "This offline entry belongs to a shift that ended more than 7 days ago",
        });
      }
      activeShift = offlineShifts[0];
    }

    if (!activeShift) {
      return res.status(409).json({
        success: false,
        code: "NO_ACTIVE_SHIFT",
        message: "No shift is active. Start a shift before adding production.",
      });
    }

    const [existingRows] = await db.query(
      `
  SELECT *
  FROM production_entries
  WHERE shift_id = ?
    AND sr_no = ?
    AND COALESCE(row_type, 'entry') = 'entry'
  LIMIT 1
  `,
      [activeShift.id, serialNumber],
    );

    // A queued offline entry is always a new entry. Its provisional SR may
    // have been taken by another user before reconnecting, so it must never
    // be treated as an edit of that newer row.
    const existingRow = hasOfflineShift
      ? null
      : existingRows.length > 0
      ? existingRows[0]
      : null;
    let activeEditGrantId = null;

    const canManageAllProduction = existingRow
      ? await hasPermission({
          userId: req.user.id,
          role: req.user.role,
          permissionKey: "production.manage_all",
        })
      : false;

    // An account without full production management needs a one-time row grant
    // before it can update an existing entry. The grant is consumed on save.
    if (existingRow && !canManageAllProduction) {
      const [grantRows] = await db.query(
        `SELECT id FROM production_edit_grants
         WHERE production_entry_id = ? AND user_id = ?
           AND used_at IS NULL AND revoked_at IS NULL
         ORDER BY id DESC LIMIT 1`,
        [existingRow.id, req.user.id],
      );
      if (!grantRows.length) {
        return res.status(403).json({
          success: false,
          code: "EDIT_GRANT_REQUIRED",
          message: "A superadmin must unlock this SR row for your account first",
        });
      }
      activeEditGrantId = grantRows[0].id;
    }

    // FULL ENTRY
    if (entry_type === "full") {
      if (!challan_no || !party_name || !material) {
        return res.status(400).json({
          success: false,
          message: "challan_no, party_name and material are required",
        });
      }

      const qty = Number(dipping_qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: "dipping_qty must be a positive whole number",
        });
      }

      if (!planning_id || !Number.isInteger(Number(planning_id))) {
        return res.status(400).json({
          success: false,
          message: "A valid planning_id is required",
        });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // Serialize SR allocation for the shift. Offline entries from
        // different plannings can reconnect together and must receive unique,
        // sequential SR numbers.
        await connection.query("SELECT id FROM shifts WHERE id = ? FOR UPDATE", [
          activeShift.id,
        ]);

        const [planningRows] = await connection.query(
          `SELECT * FROM production_planning WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
          [Number(planning_id)],
        );

        if (planningRows.length === 0) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "Production planning not found",
          });
        }

        const planning = planningRows[0];
        if (!["pending", "completed"].includes(planning.status)) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            message: "This production planning is not available",
          });
        }

        const [usedRows] = await connection.query(
          `
  SELECT COALESCE(SUM(dipping_qty), 0) AS used_qty
  FROM production_entries
  WHERE planning_id = ?
    AND COALESCE(row_type, 'entry') = 'entry'
    AND (? IS NULL OR id <> ?)
  `,
          [
            Number(planning_id),
            existingRow?.id || null,
            existingRow?.id || null,
          ],
        );

        const usedQty = Number(usedRows[0]?.used_qty) || 0;
        const remainingQty = Number(planning.planned_qty) - usedQty;

        if (qty > remainingQty) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            code: "PLANNED_QTY_EXCEEDED",
            message: `Only ${remainingQty} NOS remain for challan ${planning.challan_no}`,
            data: {
              planned_qty: Number(planning.planned_qty),
              completed_qty: usedQty,
              remaining_qty: remainingQty,
            },
          });
        }

        // if (
        //   String(challan_no) !== String(planning.challan_no) ||
        //   String(party_name) !== String(planning.party_name) ||
        //   String(material) !== String(planning.material_description)
        // ) {
        //   await connection.rollback();
        //   return res.status(400).json({
        //     success: false,
        //     message:
        //       "Selected planning details do not match the production entry",
        //   });
        // }

        const zincPercentage = calculateZincPercentage(ms_weight, gi_weight);

        const productionWeight = calculateProductionWeight(
          dipping_qty,
          ms_weight,
        );

        const avgCoating = calculateAvgCoating([c1, c2, c3, c4, c5]);

        if (existingRow) {
          await connection.query(
            `
      UPDATE production_entries
      SET
        planning_id = ?,
        challan_no = ?,
        party_name = ?,
        material = ?,
        production_time = ?,
        dipping_qty = ?,
        kettle_temperature = ?,
        ms_weight = ?,
        gi_weight = ?,
        zinc_percentage = ?,
        production_weight = ?,
        c1 = ?,
        c2 = ?,
        c3 = ?,
        c4 = ?,
        c5 = ?,
        avg_coating = ?,
        updated_by = ?
      WHERE id = ?
      `,
            [
              Number(planning_id),
              challan_no,
              party_name,
              material,
              production_time || null,
              qty,
              kettle_temperature || null,
              ms_weight || null,
              gi_weight || null,
              zincPercentage,
              productionWeight,
              c1 || null,
              c2 || null,
              c3 || null,
              c4 || null,
              c5 || null,
              avgCoating,
              req.user.id,
              existingRow.id,
            ],
          );

          const savedEntryId = existingRow.id;

          const [completedRows] = await connection.query(
            `
  SELECT COALESCE(SUM(dipping_qty), 0) AS completed_qty
  FROM production_entries
  WHERE planning_id = ?
    AND COALESCE(row_type, 'entry') = 'entry'
  `,
            [Number(planning_id)],
          );

          const completedQty = Number(completedRows[0]?.completed_qty) || 0;

          await connection.query(
            `
  UPDATE production_planning
  SET
    completed_qty = ?,
    status = CASE
      WHEN status = 'canceled' THEN 'canceled'
      WHEN planned_qty <= ? THEN 'completed'
      ELSE 'pending'
    END
  WHERE id = ?
  `,
            [completedQty, completedQty, Number(planning_id)],
          );
          if (
            existingRow.planning_id &&
            Number(existingRow.planning_id) !== Number(planning_id)
          ) {
            const [oldPlanTotals] = await connection.query(
              `
  SELECT COALESCE(SUM(dipping_qty), 0) AS completed_qty
  FROM production_entries
  WHERE planning_id = ?
    AND COALESCE(row_type, 'entry') = 'entry'
  `,
              [existingRow.planning_id],
            );
            const oldCompletedQty = Number(oldPlanTotals[0].completed_qty) || 0;
            await connection.query(
              `UPDATE production_planning
             SET completed_qty = ?,
                 status = CASE
                   WHEN status = 'canceled' THEN 'canceled'
                   WHEN planned_qty <= ? THEN 'completed'
                   ELSE 'pending'
                 END
             WHERE id = ?`,
              [oldCompletedQty, oldCompletedQty, existingRow.planning_id],
            );
          }
          await consumeEditGrant(connection, activeEditGrantId);
          await connection.commit();

          io.emit("production_updated", {
            action: "full_updated",
            type: "updated",
            shift_id: activeShift.id,
            shift_date: activeShift.shift_date,
            shift_name: activeShift.shift_name,
            sr_no: Number(sr_no),
          });

          const zincAlert = await notifyZincSafely({
            entryId: savedEntryId,
            io,
            entrySnapshot: {
              id: savedEntryId,
              planning_id: Number(planning_id),
              sr_no: Number(sr_no),
              challan_no,
              shift_date: activeShift.shift_date,
              ms_weight,
              gi_weight,
              zinc_percentage: zincPercentage,
              target_zinc_percentage: planning.target_zinc_percentage,
            },
          });

          return res.json({
            success: true,
            action: "updated",
            message: "Production entry updated successfully",
            data: {
              zinc_percentage: zincPercentage,
              production_weight: productionWeight,
              avg_coating: avgCoating,
              zinc_alert: zincAlert,
            },
          });
        }

        const [nextSrRows] = await connection.query(
          `
    SELECT COALESCE(MAX(sr_no), 0) + 1 AS next_sr_no
    FROM production_entries
    WHERE shift_id = ?
    `,
          [activeShift.id],
        );

        const nextSrNo = nextSrRows[0].next_sr_no;

        const [result] = await connection.query(
          `
    INSERT INTO production_entries
    (
      shift_id,
      shift_date,
      shift_name,
      sr_no,
      planning_id,
      client_request_id,
      challan_no,
      party_name,
      material,
      production_time,
      dipping_qty,
      kettle_temperature,
      ms_weight,
      gi_weight,
      zinc_percentage,
      production_weight,
      c1,
      c2,
      c3,
      c4,
      c5,
      avg_coating,
      row_type,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entry', ?)
    `,
          [
            activeShift.id,
            activeShift.shift_date,
            activeShift.shift_name,
            nextSrNo,
            Number(planning_id),
            clientRequestId,
            challan_no,
            party_name,
            material,
            production_time || null,
            qty,
            kettle_temperature || null,
            ms_weight || null,
            gi_weight || null,
            zincPercentage,
            productionWeight,
            c1 || null,
            c2 || null,
            c3 || null,
            c4 || null,
            c5 || null,
            avgCoating,
            req.user.id,
          ],
        );

        const completedQty = usedQty + qty;
        await connection.query(
          `UPDATE production_planning
         SET completed_qty = ?, status = ?
         WHERE id = ?`,
          [
            completedQty,
            completedQty >= Number(planning.planned_qty)
              ? "completed"
              : "pending",
            Number(planning_id),
          ],
        );
        await connection.commit();

        io.emit("production_updated", {
          action: "full_created",
          type: "created",
          production_id: result.insertId,
          shift_id: activeShift.id,
          shift_date: activeShift.shift_date,
          shift_name: activeShift.shift_name,
          sr_no: Number(nextSrNo),
        });
        const savedEntryId = result.insertId;

        const zincAlert = await notifyZincSafely({
          entryId: savedEntryId,
          io,
          retryIfAlreadySent: true,
          entrySnapshot: {
            id: savedEntryId,
            planning_id: Number(planning_id),
            sr_no: Number(nextSrNo),
            challan_no,
            shift_date: activeShift.shift_date,
            ms_weight,
            gi_weight,
            zinc_percentage: zincPercentage,
            target_zinc_percentage: planning.target_zinc_percentage,
          },
        });

        return res.status(201).json({
          success: true,
          action: "created",
          message: "Production entry created successfully",
          data: {
            production_id: result.insertId,
            sr_no: nextSrNo,
            zinc_percentage: zincPercentage,
            production_weight: productionWeight,
            avg_coating: avgCoating,
            zinc_alert: zincAlert,
          },
        });
      } catch (transactionError) {
        await connection.rollback();
        throw transactionError;
      } finally {
        connection.release();
      }
    }

    // BASIC ENTRY
    if (entry_type === "basic") {
      if (!challan_no || !party_name || !material) {
        return res.status(400).json({
          success: false,
          message: "challan_no, party_name and material are required",
        });
      }

      if (existingRow) {
        await db.query(
          `
          UPDATE production_entries
          SET
            challan_no = ?,
            party_name = ?,
            material = ?,
            updated_by = ?
          WHERE id = ?
          `,
          [challan_no, party_name, material, req.user.id, existingRow.id],
        );

        await consumeEditGrant(db, activeEditGrantId);

        io.emit("production_updated", {
          action: "basic_updated",
          type: "updated",
          shift_id: activeShift.id,
          shift_date: activeShift.shift_date,
          shift_name: activeShift.shift_name,
          sr_no: Number(sr_no),
        });

        return res.json({
          success: true,
          action: "updated",
          message: "Basic details updated successfully",
        });
      }

      const [result] = await db.query(
        `
        INSERT INTO production_entries
        (
          shift_id,
          shift_date,
          shift_name,
          sr_no,
          challan_no,
          party_name,
          material,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          activeShift.id,
          activeShift.shift_date,
          activeShift.shift_name,
          sr_no,
          challan_no,
          party_name,
          material,
          req.user.id,
        ],
      );

      io.emit("production_updated", {
        action: "basic_created",
        type: "created",
        production_id: result.insertId,
        shift_id: activeShift.id,
        shift_date: activeShift.shift_date,
        shift_name: activeShift.shift_name,
        sr_no: Number(sr_no),
      });

      return res.status(201).json({
        success: true,
        action: "created",
        message: "Basic entry created successfully",
        data: {
          production_id: result.insertId,
        },
      });
    }

    if (!existingRow) {
      return res.status(404).json({
        success: false,
        message: "This Sr No is not created in Basic Entry",
      });
    }

    // DIP ENTRY
    if (entry_type === "dip") {
      const finalDippingQty = dipping_qty ?? existingRow.dipping_qty;
      const finalMsWeight = existingRow.ms_weight;

      const productionWeight = calculateProductionWeight(
        finalDippingQty,
        finalMsWeight,
      );

      await db.query(
        `
        UPDATE production_entries
        SET
          production_time = ?,
          dipping_qty = ?,
          kettle_temperature = ?,
          production_weight = ?,
          updated_by = ?
        WHERE id = ?
        `,
        [
          production_time || null,
          dipping_qty || 0,
          kettle_temperature || null,
          productionWeight,
          req.user.id,
          existingRow.id,
        ],
      );

      await consumeEditGrant(db, activeEditGrantId);

      io.emit("production_updated", {
        action: "dip_updated",
        type: "updated",
        shift_id: activeShift.id,
        shift_date: activeShift.shift_date,
        shift_name: activeShift.shift_name,
        sr_no: Number(sr_no),
      });

      return res.json({
        success: true,
        action: "updated",
        message: "Dip details updated successfully",
        data: {
          production_weight: productionWeight,
        },
      });
    }

    // WEIGHT ENTRY
    if (entry_type === "weight") {
      const finalMsWeight = ms_weight ?? existingRow.ms_weight;
      const finalGiWeight = gi_weight ?? existingRow.gi_weight;
      const finalDippingQty = existingRow.dipping_qty;

      const zincPercentage = calculateZincPercentage(
        finalMsWeight,
        finalGiWeight,
      );

      const productionWeight = calculateProductionWeight(
        finalDippingQty,
        finalMsWeight,
      );

      await db.query(
        `
        UPDATE production_entries
        SET
          ms_weight = ?,
          gi_weight = ?,
          zinc_percentage = ?,
          production_weight = ?,
          updated_by = ?
        WHERE id = ?
        `,
        [
          ms_weight || null,
          gi_weight || null,
          zincPercentage,
          productionWeight,
          req.user.id,
          existingRow.id,
        ],
      );

      await consumeEditGrant(db, activeEditGrantId);

      io.emit("production_updated", {
        action: "weight_updated",
        type: "updated",
        shift_id: activeShift.id,
        shift_date: activeShift.shift_date,
        shift_name: activeShift.shift_name,
        sr_no: Number(sr_no),
      });

      notifyZincSafely({ entryId: existingRow.id, io });

      return res.json({
        success: true,
        action: "updated",
        message: "Weight details updated successfully",
        data: {
          zinc_percentage: zincPercentage,
          production_weight: productionWeight,
        },
      });
    }

    // COATING ENTRY
    if (entry_type === "coating") {
      const avgCoating = calculateAvgCoating([c1, c2, c3, c4, c5]);
      await db.query(
        `
        UPDATE production_entries
        SET
          c1 = ?,
          c2 = ?,
          c3 = ?,
          c4 = ?,
          c5 = ?,
          avg_coating = ?,
          updated_by = ?
        WHERE id = ?
        `,
        [
          c1 || null,
          c2 || null,
          c3 || null,
          c4 || null,
          c5 || null,
          avgCoating,
          req.user.id,
          existingRow.id,
        ],
      );

      await consumeEditGrant(db, activeEditGrantId);

      io.emit("production_updated", {
        action: "coating_updated",
        type: "updated",
        shift_id: activeShift.id,
        shift_date: activeShift.shift_date,
        shift_name: activeShift.shift_name,
        sr_no: Number(sr_no),
      });

      return res.json({
        success: true,
        action: "updated",
        message: "Coating details updated successfully",
        data: {
          avg_coating: avgCoating,
        },
      });
    }
  } catch (error) {
    console.error("saveProductionEntry:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getProductions = async (req, res) => {
  try {
    const {
      shift_date,
      shift_name,
      shift_id,
      challan_no,
      page = 1,
      limit = 50,
    } = req.query;

    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(
      500,
      Math.max(1, Number.parseInt(limit, 10) || 50),
    );
    const offset = (safePage - 1) * safeLimit;
    const canManageEveryRow = await hasPermission({
      userId: req.user.id,
      role: req.user.role,
      permissionKey: "production.manage_all",
    });

    let query = `
      SELECT 
        production_entries.*,
        creator.name AS created_by_name,
        updater.name AS updated_by_name,
        CASE
          WHEN ? = 1 THEN 1
          WHEN EXISTS (
            SELECT 1 FROM production_edit_grants peg
            WHERE peg.production_entry_id = production_entries.id
              AND peg.user_id = ? AND peg.used_at IS NULL AND peg.revoked_at IS NULL
          ) THEN 1 ELSE 0
        END AS can_edit,
        active_grant.user_id AS editable_user_id,
        grant_user.name AS editable_user_name
      FROM production_entries
      LEFT JOIN users AS creator ON creator.id = production_entries.created_by
      LEFT JOIN users AS updater ON updater.id = production_entries.updated_by
      LEFT JOIN production_edit_grants active_grant
        ON active_grant.production_entry_id = production_entries.id
       AND active_grant.used_at IS NULL AND active_grant.revoked_at IS NULL
      LEFT JOIN users AS grant_user ON grant_user.id = active_grant.user_id
      WHERE 1 = 1
    `;

    const params = [canManageEveryRow ? 1 : 0, req.user.id];

    if (shift_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(shift_date))) {
        return res.status(400).json({
          success: false,
          message: "shift_date must use YYYY-MM-DD format",
        });
      }
      query += ` AND production_entries.shift_date = ?`;
      params.push(shift_date);
    }

    if (shift_name) {
      if (!["day", "night"].includes(String(shift_name).toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: "shift_name must be day or night",
        });
      }
      query += ` AND production_entries.shift_name = ?`;
      params.push(shift_name);
    }

    if (shift_id) {
      query += ` AND production_entries.shift_id = ?`;
      params.push(shift_id);
    }

    if (challan_no) {
      query += ` AND production_entries.challan_no = ?`;
      params.push(challan_no);
    }

    query += ` ORDER BY production_entries.shift_date ASC, production_entries.sr_no ASC LIMIT ? OFFSET ?`;
    params.push(safeLimit, offset);

    const [rows] = await db.query(query, params);

    return res.json({
      success: true,
      message: "Production entries fetched successfully",
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getProductionById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `
      SELECT 
        production_entries.*,
        creator.name AS created_by_name,
        updater.name AS updated_by_name
      FROM production_entries
      LEFT JOIN users AS creator ON creator.id = production_entries.created_by
      LEFT JOIN users AS updater ON updater.id = production_entries.updated_by
      WHERE production_entries.id = ?
      `,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Production entry not found",
      });
    }

    return res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const deleteProduction = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid production entry id",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [entryRows] = await connection.query(
      `SELECT planning_id, challan_no FROM production_entries WHERE id = ? FOR UPDATE`,
      [id],
    );
    if (entryRows.length === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: "Production entry not found",
      });
    }
    const entry = entryRows[0];
    await connection.query(
      `
      DELETE FROM production_entries
      WHERE id = ?
      `,
      [id],
    );

    if (entry.planning_id) {
      const [sumRows] = await connection.query(
        `
  SELECT COALESCE(SUM(dipping_qty), 0) AS completed_qty
  FROM production_entries
  WHERE planning_id = ?
    AND COALESCE(row_type, 'entry') = 'entry'
  `,
        [entry.planning_id],
      );
      const completedQty = Number(sumRows[0].completed_qty) || 0;
      await connection.query(
        `UPDATE production_planning
         SET completed_qty = ?,
             status = CASE WHEN planned_qty <= ? THEN 'completed' ELSE 'pending' END
         WHERE id = ? AND status <> 'canceled'`,
        [completedQty, completedQty, entry.planning_id],
      );
    }
    await connection.commit();
    transactionStarted = false;

    const io = req.app.get("io");
    io.emit("production_updated", {
      action: "deleted",
      type: "deleted",
      production_id: Number(id),
    });
    io.emit("production_planning_updated", {
      action: "recalculated",
      id: entry.planning_id,
    });

    return res.json({
      success: true,
      message: "Production entry deleted successfully",
    });
  } catch (error) {
    if (transactionStarted && connection) await connection.rollback();
    console.error("deleteProduction:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  } finally {
    connection?.release();
  }
};

const grantProductionEdit = async (req, res) => {
  const entryId = Number(req.params.id);
  const userId = Number(req.body.user_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(userId)) {
    return res.status(400).json({ success: false, message: "Valid entry and user are required" });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [entries] = await connection.query(
      "SELECT id, sr_no, shift_id FROM production_entries WHERE id = ? FOR UPDATE",
      [entryId],
    );
    const [users] = await connection.query(
      `SELECT id, name, role FROM users
       WHERE id = ? AND status = 'active'
         AND role IN ('superadmin', 'plant_manager', 'admin', 'supervisor')
       LIMIT 1`,
      [userId],
    );
    if (!entries.length || !users.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Production row or active user not found" });
    }

    // Exactly one delegated production edit may be active system-wide.
    await connection.query(
      `UPDATE production_edit_grants SET revoked_at = NOW()
       WHERE used_at IS NULL AND revoked_at IS NULL`,
    );
    const [result] = await connection.query(
      `INSERT INTO production_edit_grants (production_entry_id, user_id, granted_by)
       VALUES (?, ?, ?)`,
      [entryId, userId, req.user.id],
    );
    await connection.commit();
    req.app.get("io")?.emit("production_edit_grant_updated", {
      entry_id: entryId,
      user_id: userId,
      grant_id: result.insertId,
    });
    return res.json({
      success: true,
      message: `SR ${entries[0].sr_no} is editable once by ${users[0].name}`,
    });
  } catch (error) {
    await connection.rollback();
    console.error("grantProductionEdit:", error);
    return res.status(500).json({ success: false, message: "Could not grant edit access" });
  } finally {
    connection.release();
  }
};

const updateProductionById = async (req, res) => {
  const entryId = Number(req.params.id);
  if (!Number.isInteger(entryId)) {
    return res.status(400).json({ success: false, message: "Invalid production entry id" });
  }
  const fields = [
    "planning_id", "challan_no", "party_name", "material", "production_time",
    "dipping_qty", "kettle_temperature", "ms_weight", "gi_weight",
    "c1", "c2", "c3", "c4", "c5",
  ];
  const [rows] = await db.query("SELECT * FROM production_entries WHERE id = ? LIMIT 1", [entryId]);
  if (!rows.length) return res.status(404).json({ success: false, message: "Production entry not found" });
  const current = rows[0];
  const next = Object.fromEntries(fields.map((key) => [key, req.body[key] ?? current[key]]));
  const qty = Number(next.dipping_qty);
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ success: false, message: "Dipping quantity must be a positive whole number" });
  }
  const zinc = calculateZincPercentage(next.ms_weight, next.gi_weight);
  const weight = calculateProductionWeight(qty, next.ms_weight);
  const coating = calculateAvgCoating([next.c1, next.c2, next.c3, next.c4, next.c5]);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE production_entries SET planning_id=?, challan_no=?, party_name=?, material=?,
       production_time=?, dipping_qty=?, kettle_temperature=?, ms_weight=?, gi_weight=?,
       zinc_percentage=?, production_weight=?, c1=?, c2=?, c3=?, c4=?, c5=?, avg_coating=?, updated_by=?
       WHERE id=?`,
      [next.planning_id || null, next.challan_no, next.party_name, next.material,
       next.production_time || null, qty, next.kettle_temperature || null,
       next.ms_weight || null, next.gi_weight || null, zinc, weight,
       next.c1 || null, next.c2 || null, next.c3 || null, next.c4 || null,
       next.c5 || null, coating, req.user.id, entryId],
    );
    const affectedPlans = [...new Set([current.planning_id, next.planning_id].filter(Boolean).map(Number))];
    for (const planId of affectedPlans) {
      const [totals] = await connection.query(
        "SELECT COALESCE(SUM(dipping_qty),0) completed_qty FROM production_entries WHERE planning_id=? AND COALESCE(row_type,'entry')='entry'",
        [planId],
      );
      const completed = Number(totals[0].completed_qty) || 0;
      await connection.query(
        `UPDATE production_planning SET completed_qty=?, status=CASE WHEN planned_qty<=? THEN 'completed' ELSE 'pending' END WHERE id=? AND deleted_at IS NULL`,
        [completed, completed, planId],
      );
    }
    await connection.commit();
    req.app.get("io")?.emit("production_updated", { action: "history_updated", production_id: entryId });
    notifyZincSafely({ entryId, io: req.app.get("io") });
    return res.json({ success: true, message: "Production entry updated successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("updateProductionById:", error);
    return res.status(500).json({ success: false, message: "Could not update production entry" });
  } finally {
    connection.release();
  }
};

const getProductionPreference = async (req, res) => {
  const [rows] = await db.query(
    `SELECT upp.default_planning_id, pp.challan_no, pp.party_name, pp.material_description,
            pp.planned_qty, pp.completed_qty, (pp.planned_qty-pp.completed_qty) remaining_qty
     FROM user_production_preferences upp
     LEFT JOIN production_planning pp ON pp.id=upp.default_planning_id AND pp.deleted_at IS NULL
     WHERE upp.user_id=? LIMIT 1`,
    [req.user.id],
  );
  return res.json({ success: true, data: rows[0] || { default_planning_id: null } });
};

const setProductionPreference = async (req, res) => {
  const planningId = req.body.planning_id == null ? null : Number(req.body.planning_id);
  if (planningId) {
    const [plans] = await db.query(
      "SELECT id FROM production_planning WHERE id=? AND deleted_at IS NULL AND status='pending' LIMIT 1",
      [planningId],
    );
    if (!plans.length) return res.status(404).json({ success: false, message: "Available planning challan not found" });
  }
  await db.query(
    `INSERT INTO user_production_preferences (user_id, default_planning_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE default_planning_id=VALUES(default_planning_id), updated_at=CURRENT_TIMESTAMP`,
    [req.user.id, planningId],
  );
  req.app.get("io")?.to(`user:${req.user.id}`).emit(
    "production_preference_updated",
    { user_id: req.user.id, default_planning_id: planningId },
  );
  return res.json({ success: true, message: planningId ? "Default challan saved" : "Default challan removed" });
};

module.exports = {
  saveProductionEntry,
  getProductions,
  getProductionById,
  deleteProduction,
  grantProductionEdit,
  updateProductionById,
  getProductionPreference,
  setProductionPreference,
};
