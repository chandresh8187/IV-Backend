const db = require("../config/db");
const { validateContractor } = require('../services/productionContractorService');
const {
  calculateProductionZincKg,
  applyProductionZinc,
} = require('../services/productionZincStockService');
const { hasPermission } = require("../services/permissionService");
const { getCorrectionState, getProductionContext, assertContext, lockProductionContext } = require('../services/productionShiftContextService');
const { getPlantStatusRow } = require("./plantStatusController");
const {
  checkEntryZincNotification,
} = require("../utils/checkEntryZincNotification");
const {
  notifyProductionFlowCompletion,
} = require("../utils/checkProductionFlowCompletion");
const {
  recalculatePlanningProgress,
} = require("../services/productionPlanningFlowService");
const { refreshProductionCost } = require('../services/productionCostService');

const notifyZincSafely = async ({
  entryId,
  entrySnapshot,
  retryIfAlreadySent = false,
}) => {
  try {
    const result = await checkEntryZincNotification({
      entryId,
      entrySnapshot,
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

const saveProductionEntry = async (req, res) => {
  try {
    const retiredOfflineFields = ["offline_shift_id", "offline_user_id"];
    if (
      retiredOfflineFields.some((field) =>
        Object.prototype.hasOwnProperty.call(req.body || {}, field),
      )
    ) {
      return res.status(410).json({
        success: false,
        code: "OFFLINE_PRODUCTION_REMOVED",
        message:
          "Offline production entries are no longer supported. Reopen the form while online and save again.",
      });
    }

    const requestId = req.body?.client_request_id;
    if (requestId != null) {
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(requestId) ||
          req.body.entry_type !== 'full' || Number(req.body.entry_id || 0) !== 0) {
        return res.status(400).json({ success: false, message: 'Invalid offline production request.' });
      }
      const [replayed] = await db.query(
        'SELECT id, created_by FROM production_entries WHERE client_request_id = ? LIMIT 1', [requestId],
      );
      if (replayed.length) {
        if (Number(replayed[0].created_by) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'This request belongs to another user.' });
        return res.json({ success: true, action: 'already_saved', message: 'Production entry already saved', data: { production_id: replayed[0].id } });
      }
    }

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
      labour_weight_id,
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

    const io = req.app.get("io");
    const shiftCorrectionAllowed = await hasPermission({ userId: req.user.id, role: req.user.role, permissionKey: 'shifts.correct' });
    const productionContext = await getProductionContext(null, shiftCorrectionAllowed, req.user.id);
    const activeShift = productionContext.shift;
    assertContext(req.body, productionContext);
    if (productionContext.correction && entry_type !== 'full') {
      return res.status(409).json({ success: false, message: 'Use the full production form for shift corrections' });
    }

    const plantStatus = await getPlantStatusRow();

    if (!plantStatus) {
      return res.status(500).json({
        success: false,
        message: "Plant status configuration not found",
      });
    }

    if (plantStatus.status !== "running" && !productionContext.correction) {
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

    const existingRow = existingRows.length > 0 ? existingRows[0] : null;
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
    if (existingRow && !canManageAllProduction && !productionContext.correction) {
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

    // FULL ENTRY - resolve the selected item and contractor by immutable IDs.
    if (entry_type === "full") {
      const qty = Number(dipping_qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: "dipping_qty must be a positive whole number",
        });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await lockProductionContext(connection, productionContext, req.body);
        const contractorId = await validateContractor(connection,
          Object.prototype.hasOwnProperty.call(req.body, 'contractor_id')
            ? req.body.contractor_id : existingRow?.contractor_id ?? null);
        const [lockedRows] = await connection.query(
          `SELECT id FROM production_entries WHERE shift_id = ? AND sr_no = ?
           AND COALESCE(row_type, 'entry') = 'entry' FOR UPDATE`, [activeShift.id, serialNumber],
        );
        if (Number(lockedRows[0]?.id || 0) !== Number(existingRow?.id || 0) ||
            (req.body.entry_id != null && Number(req.body.entry_id) !== Number(existingRow?.id || 0))) {
          throw Object.assign(new Error('This SR changed while the form was open. Refresh and reopen the entry.'), { status: 409 });
        }

        let planning;
        if (existingRow && (req.body.planning_item_id == null || Number(req.body.planning_item_id) === Number(existingRow.planning_item_id))) {
          const [planningRows] = await connection.query(
            `SELECT pp.id AS planning_id,
                    COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
                    COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
                    pp.created_at AS planning_created_at,
                    ppi.id AS planning_item_id, ppi.item_id,
                    COALESCE(ppi.material_description, pp.material_description) AS material_description,
                    COALESCE(ppi.planned_qty, pp.planned_qty) AS planned_qty,
                    COALESCE(ppi.completed_qty, pp.completed_qty) AS completed_qty,
                    COALESCE(ppi.target_zinc_percentage, pp.target_zinc_percentage)
                      AS target_zinc_percentage,
                    COALESCE(ppi.sequence_no, 1) AS sequence_no
             FROM production_planning pp
             LEFT JOIN production_planning_items ppi
               ON ppi.planning_id = pp.id
              AND (ppi.id = ? OR (? IS NULL AND ppi.sequence_no = 1))
             WHERE pp.id = ? AND pp.deleted_at IS NULL
             ORDER BY ppi.sequence_no ASC
             LIMIT 1 FOR UPDATE`,
            [
              existingRow.planning_item_id || null,
              existingRow.planning_item_id || null,
              existingRow.planning_id,
            ],
          );
          planning = planningRows[0] || null;
        } else {
          const planningItemId = Number(req.body.planning_item_id);
          if (!Number.isSafeInteger(planningItemId) || planningItemId < 1) {
            throw Object.assign(new Error('Select a planning challan before saving production'), { status: 400 });
          }
          const [planningRows] = await connection.query(
            `SELECT pp.id AS planning_id, ppi.id AS planning_item_id, ppi.item_id,
                    COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
                    COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
                    ppi.material_description, ppi.planned_qty, ppi.completed_qty,
                    ppi.target_zinc_percentage, ppi.sequence_no
             FROM production_planning_items ppi JOIN production_planning pp ON pp.id = ppi.planning_id
             WHERE ppi.id = ? AND pp.deleted_at IS NULL AND pp.status <> 'canceled'
               ${productionContext.correction ? '' : "AND pp.status = 'pending' AND ppi.status = 'pending'"}
             LIMIT 1 FOR UPDATE`, [planningItemId],
          );
          planning = planningRows[0] || null;
        }

        if (!planning) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            code: "NO_ACTIVE_PRODUCTION_PLAN",
            message: existingRow
              ? "The production plan linked to this entry is no longer available"
              : "No pending production plan is available. Add a production plan first.",
          });
        }

        const planningId = Number(planning.planning_id);
        const planningItemId = planning.planning_item_id
          ? Number(planning.planning_item_id)
          : null;
        const [usedRows] = await connection.query(
          `SELECT COALESCE(SUM(dipping_qty), 0) AS used_qty
           FROM production_entries
           WHERE planning_id = ?
             AND COALESCE(row_type, 'entry') = 'entry'
             AND (? IS NULL OR id <> ?)
             AND (
               planning_item_id = ?
               OR (? IS NULL AND planning_item_id IS NULL)
             )`,
          [
            planningId,
            existingRow?.id || null,
            existingRow?.id || null,
            planningItemId,
            planningItemId,
          ],
        );
        const usedQty = Number(usedRows[0]?.used_qty) || 0;
        const remainingQty = Number(planning.planned_qty) - usedQty;
        if (qty > remainingQty) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            code: "PLANNED_QTY_EXCEEDED",
            message: `Only ${remainingQty} NOS remain for ${planning.material_description} in challan ${planning.challan_no}`,
            data: {
              planned_qty: Number(planning.planned_qty),
              completed_qty: usedQty,
              remaining_qty: remainingQty,
            },
          });
        }

        const assignedChallan = planning.challan_no;
        const assignedParty = planning.party_name || "";
        const assignedMaterial = planning.material_description;
        const zincPercentage = calculateZincPercentage(ms_weight, gi_weight);
        const productionWeight = calculateProductionWeight(qty, ms_weight);
        const avgCoating = calculateAvgCoating([c1, c2, c3, c4, c5]);
        const zincStockKg = calculateProductionZincKg({
          dipping_qty: qty,
          ms_weight,
          gi_weight,
        });
        let savedEntryId;
        let savedSrNo;
        let action;
        let labourRemainingAfterSave = null;
        let labourProcessTimes = null;

        if (existingRow) {
          const [consumptionRows] = await connection.query(
            'SELECT labour_weight_id, dipping_qty FROM labour_weight_consumptions WHERE production_entry_id = ? FOR UPDATE',
            [existingRow.id],
          );
          if (consumptionRows.length) {
            const linked = consumptionRows[0];
            const [weightRows] = await connection.query('SELECT dipping_qty, consumed_qty FROM labour_weight_entries WHERE id = ? FOR UPDATE', [linked.labour_weight_id]);
            const nextConsumed = Number(weightRows[0].consumed_qty) - Number(linked.dipping_qty) + qty;
            if (nextConsumed < 0 || nextConsumed > Number(weightRows[0].dipping_qty)) {
              throw Object.assign(new Error(`This edit exceeds the ${weightRows[0].dipping_qty} NOS labour weight total.`), { status: 409 });
            }
            const [otherLinks] = await connection.query(
              `SELECT p.item_id, p.material FROM labour_weight_consumptions c
               JOIN production_entries p ON p.id = c.production_entry_id
               WHERE c.labour_weight_id = ? AND c.production_entry_id <> ? LIMIT 1`,
              [linked.labour_weight_id, existingRow.id],
            );
            if (otherLinks.length) {
              const other = otherLinks[0];
              const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
              if (other.item_id && planning.item_id
                ? Number(other.item_id) !== Number(planning.item_id)
                : normalize(other.material) !== normalize(assignedMaterial)) {
                throw Object.assign(new Error('Split labour entries must remain on challans for the same material.'), { status: 409 });
              }
            }
            await connection.query('UPDATE labour_weight_consumptions SET dipping_qty = ? WHERE production_entry_id = ?', [qty, existingRow.id]);
            await connection.query("UPDATE labour_weight_entries SET consumed_qty = ?, status = IF(? >= dipping_qty, 'used', 'pending') WHERE id = ?", [nextConsumed, nextConsumed, linked.labour_weight_id]);
          }
          await connection.query(
            `UPDATE production_entries
             SET planning_id = ?, planning_item_id = ?, item_id = ?, challan_no = ?,
                 party_name = ?, material = ?, production_time = ?,
                 dipping_qty = ?, kettle_temperature = ?, ms_weight = ?,
                 gi_weight = ?, zinc_percentage = ?, production_weight = ?,
                 c1 = ?, c2 = ?, c3 = ?, c4 = ?, c5 = ?, avg_coating = ?,
                 updated_by = ?, zinc_stock_deducted_kg = ?, contractor_id = ?
             WHERE id = ?`,
            [
              planningId,
              planningItemId,
              planning.item_id || null,
              assignedChallan,
              assignedParty,
              assignedMaterial,
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
              zincStockKg,
              contractorId,
              existingRow.id,
            ],
          );
          await consumeEditGrant(connection, activeEditGrantId);
          savedEntryId = existingRow.id;
          savedSrNo = Number(existingRow.sr_no);
          await applyProductionZinc(connection, {
            entryId: savedEntryId,
            srNo: savedSrNo,
            actorUserId: req.user.id,
            previousKg: existingRow.zinc_stock_deducted_kg,
            nextKg: zincStockKg,
          });
          action = "updated";
        } else {
          const [modeRows] = await connection.query("SELECT setting_value FROM app_settings WHERE setting_key = 'labour_weight_mode' LIMIT 1");
          let configuredWeightMode = 'manual';
          try {
            const rawMode = modeRows?.[0]?.setting_value;
            const savedMode = typeof rawMode === 'string' ? JSON.parse(rawMode) : rawMode;
            if (['manual', 'auto', 'selection'].includes(savedMode?.mode)) configuredWeightMode = savedMode.mode;
          } catch { /* An invalid setting falls back to manual input. */ }
          if (configuredWeightMode !== 'manual' && labour_weight_id == null) {
            throw Object.assign(new Error(configuredWeightMode === 'selection'
              ? 'Select the labour weight for the dip currently on the kettle.'
              : 'No pending labour weight is available. Add a labour weight first.'), { status: 400 });
          }
          const weightShiftStart = activeShift.start_time;
          const weightShiftEnd = activeShift.scheduled_end_time || activeShift.end_time;
          if (labour_weight_id != null && (!weightShiftStart || !weightShiftEnd)) {
            throw Object.assign(new Error('The production shift time is unavailable. Refresh and try again.'), { status: 409 });
          }
          if (configuredWeightMode === 'auto' && labour_weight_id != null) {
            const [firstPending] = await connection.query("SELECT id FROM labour_weight_entries WHERE status = 'pending' AND created_at >= ? AND created_at < ? ORDER BY id LIMIT 1 FOR UPDATE", [weightShiftStart, weightShiftEnd]);
            if (Number(firstPending?.[0]?.id) !== Number(labour_weight_id)) {
              throw Object.assign(new Error('The next automatic labour weight has changed. Refresh and reopen the production form.'), { status: 409 });
            }
          }
          if (labour_weight_id != null) {
            const labourEntryId = Number(labour_weight_id);
            if (!Number.isInteger(labourEntryId) || labourEntryId < 1) {
              throw Object.assign(new Error('Select a valid labour weight entry.'), { status: 400 });
            }
            const [labourRows] = await connection.query(
              `SELECT id, ms_weight, dipping_qty, consumed_qty, production_entry_id,
                      pickling_duration_seconds, flux_duration_seconds, hot_drier_duration_seconds, zinc_kettle_duration_seconds FROM labour_weight_entries
               WHERE id = ? AND status = 'pending' AND created_at >= ? AND created_at < ? FOR UPDATE`,
              [labourEntryId, weightShiftStart, weightShiftEnd],
            );
            if (!labourRows.length) {
              throw Object.assign(new Error('This labour weight was used or belongs to another shift. Refresh and reopen the production form.'), { status: 409 });
            }
            const labour = labourRows[0];
            labourProcessTimes = labour;
            const labourRemaining = Number(labour.dipping_qty) - Number(labour.consumed_qty);
            if (Number(labour.ms_weight) !== Number(ms_weight) || qty > labourRemaining) {
              throw Object.assign(new Error('The labour weight entry changed. Refresh and reopen the production form.'), { status: 409 });
            }
            if (labour.production_entry_id) {
              const [firstRows] = await connection.query(
                'SELECT item_id, material FROM production_entries WHERE id = ? FOR UPDATE',
                [labour.production_entry_id],
              );
              const first = firstRows[0];
              const sameItem = first?.item_id && planning.item_id && Number(first.item_id) === Number(planning.item_id);
              const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
              if (!first || (!sameItem && normalize(first.material) !== normalize(assignedMaterial))) {
                throw Object.assign(new Error('The remaining labour quantity must be assigned to a challan for the same material.'), { status: 409 });
              }
              if (Number(first.item_id) && Number(planning.item_id) && !sameItem) {
                throw Object.assign(new Error('The remaining labour quantity must use the same material item.'), { status: 409 });
              }
            }
            labourRemainingAfterSave = labourRemaining - qty;
            if (labourRemainingAfterSave > 0 && !labour.production_entry_id) {
              const [nextPlans] = await connection.query(
                `SELECT ppi.item_id, ppi.material_description, ppi.planned_qty, ppi.completed_qty
                 FROM production_planning_items ppi JOIN production_planning pp ON pp.id = ppi.planning_id
                 WHERE ppi.id <> ? AND pp.deleted_at IS NULL AND pp.status = 'pending'
                   AND ppi.status = 'pending' AND ppi.planned_qty > ppi.completed_qty`,
                [planningItemId],
              );
              const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
              const capacity = nextPlans.filter(item =>
                planning.item_id && item.item_id
                  ? Number(item.item_id) === Number(planning.item_id)
                  : normalize(item.material_description) === normalize(assignedMaterial)
              ).reduce((sum, item) => sum + Number(item.planned_qty) - Number(item.completed_qty), 0);
              if (capacity < labourRemainingAfterSave) {
                throw Object.assign(new Error(`Another pending challan for the same material needs ${labourRemainingAfterSave} NOS capacity before this labour quantity can be split.`), { status: 409 });
              }
            }
          }
          const [nextSrRows] = await connection.query(
            `SELECT COALESCE(MAX(sr_no), 0) + 1 AS next_sr_no
             FROM production_entries WHERE shift_id = ?`,
            [activeShift.id],
          );
          savedSrNo = Number(nextSrRows[0].next_sr_no);
          const [result] = await connection.query(
            `INSERT INTO production_entries
              (shift_id, shift_date, shift_name, sr_no, planning_id,
               planning_item_id, item_id, challan_no, party_name,
               material, production_time, dipping_qty, kettle_temperature,
               ms_weight, gi_weight, zinc_percentage, production_weight,
               c1, c2, c3, c4, c5, avg_coating,
               pickling_duration_seconds, flux_duration_seconds, hot_drier_duration_seconds, zinc_kettle_duration_seconds, row_type, created_by, client_request_id,
               zinc_stock_deducted_kg, contractor_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entry', ?, ?, ?, ?)`,
            [
              activeShift.id,
              activeShift.shift_date,
              activeShift.shift_name,
              savedSrNo,
              planningId,
              planningItemId,
              planning.item_id || null,
              assignedChallan,
              assignedParty,
              assignedMaterial,
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
              labourProcessTimes?.pickling_duration_seconds ?? null,
              labourProcessTimes?.flux_duration_seconds ?? null,
              labourProcessTimes?.hot_drier_duration_seconds ?? null,
              labourProcessTimes?.zinc_kettle_duration_seconds ?? null,
              req.user.id,
              requestId || null,
              zincStockKg,
              contractorId,
            ],
          );
          savedEntryId = result.insertId;
          if (labour_weight_id != null) {
            await connection.query(
              `UPDATE labour_weight_entries SET status = IF(consumed_qty + ? >= dipping_qty, 'used', 'pending'),
               consumed_qty = consumed_qty + ?,
               production_entry_id = COALESCE(production_entry_id, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [qty, qty, savedEntryId, Number(labour_weight_id)],
            );
            await connection.query(
              'INSERT INTO labour_weight_consumptions (labour_weight_id, production_entry_id, dipping_qty) VALUES (?, ?, ?)',
              [Number(labour_weight_id), savedEntryId, qty],
            );
          }
          await applyProductionZinc(connection, {
            entryId: savedEntryId,
            srNo: savedSrNo,
            actorUserId: req.user.id,
            nextKg: zincStockKg,
          });
          action = "created";
        }

        if (existingRow?.planning_id && Number(existingRow.planning_id) !== planningId) {
          await recalculatePlanningProgress(connection, existingRow.planning_id);
        }
        const progress = await recalculatePlanningProgress(
          connection,
          planningId,
        );
        const productionCost = await refreshProductionCost(connection, {
          entryId: savedEntryId,
          shiftDate: activeShift.shift_date,
          zincPercentage,
        });
        await connection.commit();

        io.emit("production_updated", {
          action: `full_${action}`,
          type: action,
          production_id: savedEntryId,
          shift_id: activeShift.id,
          shift_date: activeShift.shift_date,
          shift_name: activeShift.shift_name,
          sr_no: savedSrNo,
        });
        io.emit("zinc_stock_updated", { action: "production_updated" });
        io.emit("production_planning_updated", {
          action: "progress_updated",
          id: planningId,
        });
        if (labour_weight_id != null && action === "created") {
          io.emit("labour_weights_updated", { action: labourRemainingAfterSave ? "partially_used" : "used", id: Number(labour_weight_id) });
        }

        const zincAlert = await notifyZincSafely({
          entryId: savedEntryId,
          retryIfAlreadySent: action === "created",
          entrySnapshot: {
            id: savedEntryId,
            planning_id: planningId,
            planning_item_id: planningItemId,
            sr_no: savedSrNo,
            challan_no: assignedChallan,
            shift_date: activeShift.shift_date,
            ms_weight,
            gi_weight,
            zinc_percentage: zincPercentage,
            production_cost: productionCost?.production_cost ?? null,
            target_zinc_percentage: planning.target_zinc_percentage,
          },
        });
        let completionNotification = null;
        if (progress?.status === "completed") {
          completionNotification = await notifyProductionFlowCompletion({
            planningId,
          }).catch((error) => {
            console.error("Production completion notification failed:", error);
            return { triggered: false, reason: "NOTIFICATION_FAILED" };
          });
        }

        return res.status(action === "created" ? 201 : 200).json({
          success: true,
          action,
          message: `Production entry ${action} successfully`,
          data: {
            production_id: savedEntryId,
            contractor_id: contractorId,
            sr_no: savedSrNo,
            planning_id: planningId,
            planning_item_id: planningItemId,
            challan_no: assignedChallan,
            material: assignedMaterial,
            zinc_percentage: zincPercentage,
            production_weight: productionWeight,
            avg_coating: avgCoating,
            zinc_alert: zincAlert,
            completion_notification: completionNotification,
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

      const productionCost = await refreshProductionCost(db, {
        entryId: existingRow.id,
        shiftDate: existingRow.shift_date,
        zincPercentage: existingRow.zinc_percentage,
      });

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

      const productionCost = await refreshProductionCost(db, {
        entryId: existingRow.id,
        shiftDate: existingRow.shift_date,
        zincPercentage,
      });

      await consumeEditGrant(db, activeEditGrantId);

      io.emit("production_updated", {
        action: "weight_updated",
        type: "updated",
        shift_id: activeShift.id,
        shift_date: activeShift.shift_date,
        shift_name: activeShift.shift_name,
        sr_no: Number(sr_no),
      });

      notifyZincSafely({ entryId: existingRow.id });

      return res.json({
        success: true,
        action: "updated",
        message: "Weight details updated successfully",
        data: {
          zinc_percentage: zincPercentage,
          production_weight: productionWeight,
          production_cost: productionCost?.production_cost ?? null,
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
    if (error.code === 'ER_DUP_ENTRY' && req.body?.client_request_id) {
      const [replayed] = await db.query(
        'SELECT id, created_by FROM production_entries WHERE client_request_id = ? LIMIT 1',
        [req.body.client_request_id],
      );
      if (replayed.length && Number(replayed[0].created_by) === Number(req.user.id)) {
        return res.json({ success: true, action: 'already_saved', message: 'Production entry already saved', data: { production_id: replayed[0].id } });
      }
    }
    console.error("saveProductionEntry:", error);
    return res.status(error.status || 500).json({
      success: false,
      code: error.code,
      message: error.status ? error.message : "Server error",
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
    const correction = await getCorrectionState();
    const canCorrect = correction.correction_shift_id && Number(correction.correction_user_id) === Number(req.user.id) && await hasPermission({
      userId: req.user.id, role: req.user.role, permissionKey: 'production.save',
    });

    let query = `
      SELECT 
        production_entries.*,
        contractor.name AS contractor_name,
        creator.name AS created_by_name,
        updater.name AS updated_by_name,
        CASE
          WHEN ? = 1 THEN 1
          WHEN production_entries.shift_id = ? THEN 1
          WHEN EXISTS (
            SELECT 1 FROM production_edit_grants peg
            WHERE peg.production_entry_id = production_entries.id
              AND peg.user_id = ? AND peg.used_at IS NULL AND peg.revoked_at IS NULL
          ) THEN 1 ELSE 0
        END AS can_edit,
        active_grant.user_id AS editable_user_id,
        grant_user.name AS editable_user_name
      FROM production_entries
      LEFT JOIN contractors AS contractor ON contractor.id = production_entries.contractor_id
      LEFT JOIN users AS creator ON creator.id = production_entries.created_by
      LEFT JOIN users AS updater ON updater.id = production_entries.updated_by
      LEFT JOIN production_edit_grants active_grant
        ON active_grant.production_entry_id = production_entries.id
       AND active_grant.used_at IS NULL AND active_grant.revoked_at IS NULL
      LEFT JOIN users AS grant_user ON grant_user.id = active_grant.user_id
      WHERE 1 = 1
    `;

    const params = [canManageEveryRow ? 1 : 0, canCorrect ? correction.correction_shift_id : null, req.user.id];

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
    return res.status(error.status || 500).json({
      success: false,
      code: error.code,
      message: error.status ? error.message : "Server error",
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
        contractor.name AS contractor_name,
        creator.name AS created_by_name,
        updater.name AS updated_by_name
      FROM production_entries
      LEFT JOIN contractors AS contractor ON contractor.id = production_entries.contractor_id
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
      `SELECT planning_id, planning_item_id, challan_no, sr_no,
              COALESCE(zinc_stock_deducted_kg, 0) AS zinc_stock_deducted_kg
       FROM production_entries WHERE id = ? FOR UPDATE`,
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
    await applyProductionZinc(connection, {
      entryId: id,
      srNo: entry.sr_no,
      actorUserId: req.user.id,
      previousKg: entry.zinc_stock_deducted_kg,
      nextKg: 0,
    });
    const [linkedRows] = await connection.query(
      'SELECT labour_weight_id, dipping_qty FROM labour_weight_consumptions WHERE production_entry_id = ? FOR UPDATE', [id],
    );
    if (linkedRows.length) {
      const linked = linkedRows[0];
      await connection.query('DELETE FROM labour_weight_consumptions WHERE production_entry_id = ?', [id]);
      const [nextLinks] = await connection.query(
        'SELECT production_entry_id FROM labour_weight_consumptions WHERE labour_weight_id = ? ORDER BY id LIMIT 1',
        [linked.labour_weight_id],
      );
      await connection.query(
        "UPDATE labour_weight_entries SET consumed_qty = GREATEST(consumed_qty - ?, 0), status = 'pending', production_entry_id = ? WHERE id = ?",
        [linked.dipping_qty, nextLinks[0]?.production_entry_id || null, linked.labour_weight_id],
      );
    }
    await connection.query(
      `
      DELETE FROM production_entries
      WHERE id = ?
      `,
      [id],
    );

    if (entry.planning_id) {
      await recalculatePlanningProgress(connection, entry.planning_id);
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
    io.emit("zinc_stock_updated", { action: "production_deleted" });
    if (linkedRows.length) io.emit('labour_weights_updated', { action: 'production_deleted', id: linkedRows[0].labour_weight_id });

    return res.json({
      success: true,
      message: "Production entry deleted successfully",
    });
  } catch (error) {
    if (transactionStarted && connection) await connection.rollback();
    console.error("deleteProduction:", error);
    return res.status(error.status || 500).json({
      success: false,
      code: error.code,
      message: error.status ? error.message : "Server error",
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
    "production_time", "dipping_qty", "kettle_temperature", "ms_weight", "gi_weight",
    "c1", "c2", "c3", "c4", "c5",
  ];
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM production_entries WHERE id = ? FOR UPDATE", [entryId]);
    if (!rows.length) throw Object.assign(new Error('Production entry not found'), { status: 404 });
    const current = rows[0];
    const next = Object.fromEntries(fields.map((key) => [key, req.body[key] ?? current[key]]));
    const qty = Number(next.dipping_qty);
    if (!Number.isInteger(qty) || qty <= 0) throw Object.assign(new Error('Dipping quantity must be a positive whole number'), { status: 400 });
    const planningItemId = req.body.planning_item_id == null
      ? Number(current.planning_item_id || 0)
      : Number(req.body.planning_item_id);
    if (req.body.planning_item_id != null && (!Number.isSafeInteger(planningItemId) || planningItemId < 1)) {
      throw Object.assign(new Error('Select a valid planning challan item.'), { status: 400 });
    }
    const planningChanged = planningItemId > 0 && planningItemId !== Number(current.planning_item_id);
    let target = null;
    if (planningItemId > 0) {
      const [plans] = await connection.query(
        `SELECT ppi.id AS planning_item_id, ppi.planning_id, ppi.item_id,
                ppi.planned_qty, COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
                COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
                ppi.material_description
         FROM production_planning_items ppi
         JOIN production_planning pp ON pp.id = ppi.planning_id
         WHERE ppi.id = ? ${planningChanged ? "AND pp.deleted_at IS NULL AND pp.status <> 'canceled'" : ''}
         FOR UPDATE`, [planningItemId],
      );
      target = plans[0] || null;
      if (!target && planningChanged) throw Object.assign(new Error('Selected challan is no longer available.'), { status: 409 });
      if (target) {
        const [usedRows] = await connection.query(
          `SELECT COALESCE(SUM(dipping_qty), 0) AS used_qty FROM production_entries
           WHERE planning_item_id = ? AND id <> ? AND COALESCE(row_type, 'entry') = 'entry'`,
          [planningItemId, entryId],
        );
        const remaining = Number(target.planned_qty) - Number(usedRows[0].used_qty);
        if (qty > remaining) throw Object.assign(new Error(`Only ${Math.max(0, remaining)} NOS remain for challan ${target.challan_no}.`), { status: 409, code: 'PLANNED_QTY_EXCEEDED' });
      }
    }
    const zinc = calculateZincPercentage(next.ms_weight, next.gi_weight);
    const weight = calculateProductionWeight(qty, next.ms_weight);
    const coating = calculateAvgCoating([next.c1, next.c2, next.c3, next.c4, next.c5]);
    const zincStockKg = calculateProductionZincKg(next);
    await connection.query(
      `UPDATE production_entries SET production_time=?, dipping_qty=?, kettle_temperature=?, ms_weight=?, gi_weight=?,
       zinc_percentage=?, production_weight=?, c1=?, c2=?, c3=?, c4=?, c5=?, avg_coating=?, updated_by=?,
       zinc_stock_deducted_kg=?, planning_id=?, planning_item_id=?, item_id=?, challan_no=?, party_name=?, material=?
       WHERE id=?`,
      [next.production_time || null, qty, next.kettle_temperature || null,
       next.ms_weight || null, next.gi_weight || null, zinc, weight,
       next.c1 || null, next.c2 || null, next.c3 || null, next.c4 || null,
       next.c5 || null, coating, req.user.id, zincStockKg,
       planningChanged ? target.planning_id : current.planning_id,
       planningItemId || null,
       planningChanged ? target.item_id : current.item_id,
       planningChanged ? target.challan_no : current.challan_no,
       planningChanged ? target.party_name : current.party_name,
       planningChanged ? target.material_description : current.material,
       entryId],
    );
    await applyProductionZinc(connection, {
      entryId,
      srNo: current.sr_no,
      actorUserId: req.user.id,
      previousKg: current.zinc_stock_deducted_kg,
      nextKg: zincStockKg,
    });
    await refreshProductionCost(connection, {
      entryId,
      shiftDate: current.shift_date,
      zincPercentage: zinc,
    });
    if (planningChanged && current.planning_id) await recalculatePlanningProgress(connection, current.planning_id);
    const nextPlanningId = planningChanged ? target.planning_id : current.planning_id;
    const progress = nextPlanningId ? await recalculatePlanningProgress(connection, nextPlanningId) : null;
    await connection.commit();
    req.app.get("io")?.emit("production_updated", { action: "history_updated", production_id: entryId });
    req.app.get("io")?.emit("zinc_stock_updated", { action: "production_updated" });
    if (current.planning_id) req.app.get("io")?.emit("production_planning_updated", { action: "progress_updated", id: current.planning_id });
    if (planningChanged) req.app.get("io")?.emit("production_planning_updated", { action: "progress_updated", id: nextPlanningId });
    notifyZincSafely({ entryId });
    if (progress?.status === "completed") {
      notifyProductionFlowCompletion({ planningId: nextPlanningId }).catch(
        (error) => console.error("Production completion notification failed:", error),
      );
    }
    return res.json({ success: true, message: "Production entry updated successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("updateProductionById:", error);
    return res.status(error.status || 500).json({
      success: false,
      code: error.code,
      message: error.status ? error.message : "Could not update production entry",
    });
  } finally {
    connection?.release();
  }
};

const getProductionPreference = async (req, res) => {
  const [rows] = await db.query(
    'SELECT default_planning_id, default_planning_item_id, default_contractor_id FROM user_production_preferences WHERE user_id = ?',
    [req.user.id],
  );
  return res.json({ success: true, data: rows[0] || {
    default_planning_id: null, default_planning_item_id: null, default_contractor_id: null,
  } });
};

const setProductionPreference = async (req, res) => {
  const body = req.body || {};
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  if (!['planning_item_id', 'planning_id', 'contractor_id'].some(has)) {
    return res.status(400).json({ success: false, message: 'Choose a default to update.' });
  }
  for (const key of ['planning_item_id', 'planning_id', 'contractor_id']) {
    if (has(key) && body[key] !== null &&
        (!['number', 'string'].includes(typeof body[key]) || !Number.isSafeInteger(Number(body[key])) || Number(body[key]) <= 0)) {
      return res.status(400).json({ success: false, message: 'Invalid default selection.' });
    }
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const changes = {};
    if (has('planning_item_id') || has('planning_id')) {
      let item = null;
      if (body.planning_item_id != null || (!has('planning_item_id') && body.planning_id != null)) {
        const byItem = has('planning_item_id');
        const [items] = await connection.query(
          `SELECT ppi.id, ppi.planning_id FROM production_planning_items ppi
           JOIN production_planning pp ON pp.id = ppi.planning_id
           WHERE ${byItem ? 'ppi.id' : 'pp.id'} = ? AND pp.deleted_at IS NULL
             AND pp.status = 'pending' AND ppi.status = 'pending'
             AND ppi.planned_qty > ppi.completed_qty LOCK IN SHARE MODE`,
          [Number(byItem ? body.planning_item_id : body.planning_id)],
        );
        if (items.length !== 1) throw Object.assign(new Error('Select one available challan/material item.'), { status: 409 });
        item = items[0];
      }
      changes.default_planning_id = item ? Number(item.planning_id) : null;
      changes.default_planning_item_id = item ? Number(item.id) : null;
    }
    if (has('contractor_id')) changes.default_contractor_id = await validateContractor(connection, body.contractor_id);
    const columns = Object.keys(changes); // Only the fixed names above can enter SQL.
    await connection.query(
      `INSERT INTO user_production_preferences (user_id, ${columns.join(', ')})
       VALUES (?, ${columns.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${columns.map(column => column + '=VALUES(' + column + ')').join(', ')}, updated_at=CURRENT_TIMESTAMP`,
      [req.user.id, ...Object.values(changes)],
    );
    await connection.commit();
    req.app.get('io')?.to(`user:${req.user.id}`).emit('production_preference_updated', { user_id: req.user.id });
    return res.json({ success: true, message: 'Production default updated', data: changes });
  } catch (error) {
    await connection.rollback();
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not save production default.' });
  } finally { connection.release(); }
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
