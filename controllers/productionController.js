const db = require("../config/db");
const { ensureAutomaticShift } = require("../services/automaticShiftService");
const { getPlantStatusRow } = require("./plantStatusController");
const { checkPlanningCompletion } = require("../utils/checkPlanningCompletion");
const {
  checkEntryZincNotification,
} = require("../utils/checkEntryZincNotification");
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

    if (!sr_no) {
      return res.status(400).json({
        success: false,
        message: "sr_no is required",
      });
    }

    const io = req.app.get("io");

    const plantStatus = await getPlantStatusRow();

    if (!plantStatus) {
      return res.status(500).json({
        success: false,
        message: "Plant status configuration not found",
      });
    }

    if (plantStatus.status !== "running") {
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

    const activeShift = await getActiveShift();

    const [existingRows] = await db.query(
      `
  SELECT *
  FROM production_entries
  WHERE shift_id = ?
    AND sr_no = ?
    AND COALESCE(row_type, 'entry') = 'entry'
  LIMIT 1
  `,
      [activeShift.id, sr_no],
    );

    const existingRow = existingRows.length > 0 ? existingRows[0] : null;

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

        const [planningRows] = await connection.query(
          `SELECT * FROM production_planning WHERE id = ? FOR UPDATE`,
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
          await connection.commit();

          io.emit("production_updated", {
            action: "full_updated",
            type: "updated",
            shift_id: activeShift.id,
            shift_date: activeShift.shift_date,
            shift_name: activeShift.shift_name,
            sr_no: Number(sr_no),
          });

          await checkEntryZincNotification({
            entryId: savedEntryId,
            io,
          });

          return res.json({
            success: true,
            action: "updated",
            message: "Production entry updated successfully",
            data: {
              zinc_percentage: zincPercentage,
              production_weight: productionWeight,
              avg_coating: avgCoating,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entry', ?)
    `,
          [
            activeShift.id,
            activeShift.shift_date,
            activeShift.shift_name,
            nextSrNo,
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

        await checkEntryZincNotification({
          entryId: savedEntryId,
          io,
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

      io.emit("production_updated", {
        action: "weight_updated",
        type: "updated",
        shift_id: activeShift.id,
        shift_date: activeShift.shift_date,
        shift_name: activeShift.shift_name,
        sr_no: Number(sr_no),
      });

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
      100,
      Math.max(1, Number.parseInt(limit, 10) || 50),
    );
    const offset = (safePage - 1) * safeLimit;

    let query = `
      SELECT 
        production_entries.*,
        creator.name AS created_by_name,
        updater.name AS updated_by_name
      FROM production_entries
      LEFT JOIN users AS creator ON creator.id = production_entries.created_by
      LEFT JOIN users AS updater ON updater.id = production_entries.updated_by
      WHERE 1 = 1
    `;

    const params = [];

    if (shift_date) {
      query += ` AND production_entries.shift_date = ?`;
      params.push(shift_date);
    }

    if (shift_name) {
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
  try {
    const { id } = req.params;
    const connection = await db.getConnection();
    await connection.beginTransaction();
    const [entryRows] = await connection.query(
      `SELECT planning_id, challan_no FROM production_entries WHERE id = ? FOR UPDATE`,
      [id],
    );
    if (entryRows.length === 0) {
      await connection.rollback();
      connection.release();
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
    connection.release();

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
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  saveProductionEntry,
  getProductions,
  getProductionById,
  deleteProduction,
};
