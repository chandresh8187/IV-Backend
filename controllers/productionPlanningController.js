const db = require("../config/db");
const { getConfiguredCurrentFinancialYear } = require('../services/financialYearService');
const {
  checkPlanningZincNotification,
} = require("../utils/checkEntryZincNotification");
const {
  getActivePlanningItem,
} = require("../services/productionPlanningFlowService");

const makeHttpError = (status, message, code) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const parsePositiveId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const normalizeChallanNumber = (value) => {
  const number = String(value || "").trim();
  if (!/^\d{1,40}$/.test(number)) {
    throw makeHttpError(
      400,
      "Challan number must contain only numbers",
      "INVALID_CHALLAN_NUMBER",
    );
  }
  return number;
};

const normalizeMaterialDetail = (value, index) => {
  const detail = String(value || "").trim().replace(/\s+/g, " ");
  if (detail.length > 255) {
    throw makeHttpError(400, `Material description for item ${index + 1} is too long`);
  }
  return detail;
};

const normalizePlanningItems = async (queryable, value) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw makeHttpError(
      400,
      "Add at least one material to the production plan",
      "PLANNING_ITEMS_REQUIRED",
    );
  }
  if (value.length > 100) {
    throw makeHttpError(400, "A production plan can contain up to 100 items");
  }

  const normalized = value.map((item, index) => {
    const challanNumber = normalizeChallanNumber(item?.challan_number);
    const partyName = String(item?.party_name || "").trim();
    const itemId = parsePositiveId(item?.item_id);
    const plannedQty = Number(item?.planned_qty);
    const target = Number(item?.target_zinc_percentage);
    const planningItemId = item?.id == null ? null : parsePositiveId(item.id);
    const materialDetail = normalizeMaterialDetail(item?.material_detail, index);

    if (!partyName) {
      throw makeHttpError(400, `Enter a party name for item ${index + 1}`);
    }
    if (partyName.length > 255) {
      throw makeHttpError(400, `Party name for item ${index + 1} is too long`);
    }
    if (!itemId) {
      throw makeHttpError(400, `Select a material for item ${index + 1}`);
    }
    if (!Number.isInteger(plannedQty) || plannedQty <= 0) {
      throw makeHttpError(
        400,
        `Planned quantity for item ${index + 1} must be a positive whole number`,
      );
    }
    if (!Number.isFinite(target) || target <= 0 || target > 100) {
      throw makeHttpError(
        400,
        `Target zinc percentage for item ${index + 1} must be between 0 and 100`,
      );
    }
    if (item?.id != null && !planningItemId) {
      throw makeHttpError(400, `Invalid planning item at position ${index + 1}`);
    }

    return {
      id: planningItemId,
      challan_number: challanNumber,
      party_name: partyName,
      item_id: itemId,
      material_detail: materialDetail,
      planned_qty: plannedQty,
      target_zinc_percentage: target,
      sequence_no: index + 1,
    };
  });

  const uniqueItemIds = [...new Set(normalized.map((item) => item.item_id))];
  const placeholders = uniqueItemIds.map(() => "?").join(", ");
  const [itemRows] = await queryable.query(
    `SELECT id, item_name FROM items WHERE id IN (${placeholders})`,
    uniqueItemIds,
  );
  const itemsById = new Map(itemRows.map((item) => [Number(item.id), item]));
  if (itemsById.size !== uniqueItemIds.length) {
    throw makeHttpError(
      400,
      "One or more selected materials no longer exist in Items",
      "PLANNING_ITEM_NOT_FOUND",
    );
  }

  return normalized.map((item, index) => {
    const itemName = itemsById.get(item.item_id).item_name;
    const materialDescription = item.material_detail
      ? `${itemName} + ${item.material_detail}`
      : itemName;
    if (materialDescription.length > 255) {
      throw makeHttpError(
        400,
        `Material and description for item ${index + 1} are too long`,
      );
    }
    return { ...item, material_description: materialDescription };
  });
};

const sendError = (res, error, fallbackMessage) =>
  res.status(error?.status || 500).json({
    success: false,
    ...(error?.code ? { code: error.code } : {}),
    message: error?.status ? error.message : fallbackMessage,
  });

const createProductionPlanning = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const financialYear = await getConfiguredCurrentFinancialYear(connection);
    if (req.body.financial_year_id != null && Number(req.body.financial_year_id) !== Number(financialYear.id)) {
      throw makeHttpError(409, 'The current financial year changed. Review the year in the form and save again.', 'CURRENT_FINANCIAL_YEAR_CHANGED');
    }
    const planningItems = (
      await normalizePlanningItems(connection, req.body?.items)
    ).map((item) => ({
      ...item,
      challan_no: `DC/${financialYear.financial_year}/${item.challan_number}`,
    }));
    const uniqueChallans = new Set(
      planningItems.map((item) => item.challan_no.toLowerCase()),
    );
    if (uniqueChallans.size !== planningItems.length) {
      throw makeHttpError(
        400,
        "Each challan number can be added only once in a production flow",
        "DUPLICATE_CHALLAN",
      );
    }

    const challanPlaceholders = planningItems.map(() => "?").join(", ");
    const challanValues = planningItems.map((item) => item.challan_no);
    const [duplicates] = await connection.query(
      `SELECT challan_no FROM production_planning
       WHERE challan_no IN (${challanPlaceholders})
       UNION ALL
       SELECT challan_no FROM production_planning_items
       WHERE challan_no IN (${challanPlaceholders})
       LIMIT 1`,
      [...challanValues, ...challanValues],
    );
    if (duplicates.length) {
      throw makeHttpError(
        409,
        `Challan ${duplicates[0].challan_no} already exists`,
        "DUPLICATE_CHALLAN",
      );
    }

    const totalPlannedQty = planningItems.reduce(
      (sum, item) => sum + item.planned_qty,
      0,
    );
    const [result] = await connection.query(
      `INSERT INTO production_planning
       (financial_year_id, challan_no, party_name, material_description, planned_qty,
        target_zinc_percentage, third_party_name, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`,
      [
        financialYear.id,
        planningItems[0].challan_no,
        planningItems[0].party_name,
        planningItems[0].material_description,
        totalPlannedQty,
        planningItems[0].target_zinc_percentage,
        req.user.id,
      ],
    );

    for (const item of planningItems) {
      await connection.query(
        `INSERT INTO production_planning_items
         (planning_id, challan_no, party_name, item_id, material_detail, material_description, planned_qty,
          target_zinc_percentage, sequence_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          item.challan_no,
          item.party_name,
          item.item_id,
          item.material_detail || null,
          item.material_description,
          item.planned_qty,
          item.target_zinc_percentage,
          item.sequence_no,
        ],
      );
    }

    await connection.commit();
    req.app.get("io")?.emit("production_planning_updated", {
      action: "created",
      id: result.insertId,
    });
    return res.status(201).json({
      success: true,
      message: "Production planning saved successfully",
      data: { id: result.insertId, challan_no: planningItems[0].challan_no },
    });
  } catch (error) {
    await connection.rollback();
    if (!error?.status) console.error("createProductionPlanning:", error);
    return sendError(res, error, "Could not save production planning");
  } finally {
    connection.release();
  }
};

const updateProductionPlanning = async (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid production planning id",
    });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [planningRows] = await connection.query(
      `SELECT * FROM production_planning
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [id],
    );
    if (!planningRows.length) {
      throw makeHttpError(404, "Production planning not found");
    }

    const planning = planningRows[0];
    const planningItems = await normalizePlanningItems(
      connection,
      req.body?.items,
    );

    const [existingItems] = await connection.query(
      `SELECT id, challan_no, party_name, item_id, material_description,
              planned_qty, completed_qty
       FROM production_planning_items
       WHERE planning_id = ?
       ORDER BY sequence_no ASC FOR UPDATE`,
      [id],
    );
    const existingById = new Map(
      existingItems.map((item) => [Number(item.id), item]),
    );
    const financialYear = planning.financial_year_id
      ? (
          await connection.query(
            "SELECT id, financial_year FROM financial_years WHERE id = ? LIMIT 1",
            [planning.financial_year_id],
          )
        )[0][0]
      : await getConfiguredCurrentFinancialYear(connection);
    if (!financialYear) {
      throw makeHttpError(
        409,
        "The financial year linked to this production plan no longer exists",
        "PLANNING_FINANCIAL_YEAR_NOT_FOUND",
      );
    }
    const currentPrefix = `DC/${financialYear.financial_year}/`;
    planningItems.forEach((item) => {
      const existingItem = item.id ? existingById.get(item.id) : null;
      const previousChallan =
        existingItem?.challan_no ||
        (existingItem === existingItems[0] ? planning.challan_no : "");
      const previousPrefix = String(previousChallan || "").match(
        /^DC\/[^/]+\//i,
      )?.[0];
      item.challan_no = `${previousPrefix || currentPrefix}${item.challan_number}`;
    });

    const uniqueChallans = new Set(
      planningItems.map((item) => item.challan_no.toLowerCase()),
    );
    if (uniqueChallans.size !== planningItems.length) {
      throw makeHttpError(
        400,
        "Each challan number can be added only once in a production flow",
        "DUPLICATE_CHALLAN",
      );
    }
    const challanPlaceholders = planningItems.map(() => "?").join(", ");
    const challanValues = planningItems.map((item) => item.challan_no);
    const [duplicates] = await connection.query(
      `SELECT challan_no FROM production_planning
       WHERE id <> ? AND challan_no IN (${challanPlaceholders})
       UNION ALL
       SELECT challan_no FROM production_planning_items
       WHERE planning_id <> ? AND challan_no IN (${challanPlaceholders})
       LIMIT 1`,
      [id, ...challanValues, id, ...challanValues],
    );
    if (duplicates.length) {
      throw makeHttpError(
        409,
        `Challan ${duplicates[0].challan_no} already exists`,
        "DUPLICATE_CHALLAN",
      );
    }

    const submittedExistingIds = new Set(
      planningItems.filter((item) => item.id).map((item) => item.id),
    );
    for (const submittedId of submittedExistingIds) {
      if (!existingById.has(submittedId)) {
        throw makeHttpError(400, "A planning item does not belong to this plan");
      }
    }

    const [usageRows] = await connection.query(
      `SELECT planning_item_id, COALESCE(SUM(dipping_qty), 0) AS completed_qty
       FROM production_entries
       WHERE planning_id = ? AND COALESCE(row_type, 'entry') = 'entry'
       GROUP BY planning_item_id`,
      [id],
    );
    const usedByItemId = new Map(
      usageRows
        .filter((row) => row.planning_item_id != null)
        .map((row) => [Number(row.planning_item_id), Number(row.completed_qty) || 0]),
    );
    const legacyCompletedQty =
      existingItems.length === 1
        ? Number(
            usageRows.find((row) => row.planning_item_id == null)?.completed_qty,
          ) || 0
        : 0;

    for (const existingItem of existingItems) {
      const submitted = planningItems.find(
        (item) => item.id === Number(existingItem.id),
      );
      const completedQty =
        (usedByItemId.get(Number(existingItem.id)) || 0) + legacyCompletedQty;
      if (!submitted && completedQty > 0) {
        throw makeHttpError(
          409,
          `${existingItem.material_description} cannot be removed because production has started`,
        );
      }
      if (
        submitted &&
        submitted.item_id !== Number(existingItem.item_id) &&
        completedQty > 0
      ) {
        throw makeHttpError(
          409,
          `${existingItem.material_description} cannot be changed because production has started`,
        );
      }
      if (submitted && submitted.planned_qty < completedQty) {
        throw makeHttpError(
          409,
          `Planned quantity for ${submitted.material_description} cannot be below completed quantity (${completedQty} NOS)`,
        );
      }
      if (submitted) submitted.completed_qty = completedQty;
    }

    const removableIds = existingItems
      .filter((item) => !submittedExistingIds.has(Number(item.id)))
      .map((item) => Number(item.id));
    if (removableIds.length) {
      await connection.query(
        `DELETE FROM production_planning_items
         WHERE planning_id = ? AND id IN (${removableIds.map(() => "?").join(", ")})`,
        [id, ...removableIds],
      );
    }

    await connection.query(
      `UPDATE production_planning_items
       SET sequence_no = sequence_no + 1000000
       WHERE planning_id = ?`,
      [id],
    );

    for (const item of planningItems) {
      if (item.id) {
        await connection.query(
          `UPDATE production_planning_items
           SET challan_no = ?, party_name = ?, item_id = ?, material_detail = ?,
               material_description = ?, planned_qty = ?,
               completed_qty = ?, target_zinc_percentage = ?, sequence_no = ?,
               status = CASE WHEN ? >= ? THEN 'completed' ELSE 'pending' END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND planning_id = ?`,
          [
            item.challan_no,
            item.party_name,
            item.item_id,
            item.material_detail || null,
            item.material_description,
            item.planned_qty,
            item.completed_qty || 0,
            item.target_zinc_percentage,
            item.sequence_no,
            item.completed_qty || 0,
            item.planned_qty,
            item.id,
            id,
          ],
        );
      } else {
        await connection.query(
          `INSERT INTO production_planning_items
           (planning_id, challan_no, party_name, item_id, material_detail, material_description, planned_qty,
            target_zinc_percentage, sequence_no)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            item.challan_no,
            item.party_name,
            item.item_id,
            item.material_detail || null,
            item.material_description,
            item.planned_qty,
            item.target_zinc_percentage,
            item.sequence_no,
          ],
        );
      }
    }

    const totalPlannedQty = planningItems.reduce(
      (sum, item) => sum + item.planned_qty,
      0,
    );
    const totalCompletedQty = planningItems.reduce(
      (sum, item) => sum + (item.completed_qty || 0),
      0,
    );
    const status =
      totalCompletedQty >= totalPlannedQty ? "completed" : "pending";
    await connection.query(
      `UPDATE production_planning
       SET financial_year_id = ?, challan_no = ?, party_name = ?, material_description = ?,
           planned_qty = ?, completed_qty = ?, target_zinc_percentage = ?,
           third_party_name = NULL, status = ?, updated_by = ?
       WHERE id = ?`,
      [
        financialYear.id,
        planningItems[0].challan_no,
        planningItems[0].party_name,
        planningItems[0].material_description,
        totalPlannedQty,
        totalCompletedQty,
        planningItems[0].target_zinc_percentage,
        status,
        req.user.id,
        id,
      ],
    );
    await connection.query(
      `UPDATE production_entries pe
       LEFT JOIN production_planning_items ppi ON ppi.id = pe.planning_item_id
       SET pe.challan_no = COALESCE(ppi.challan_no, pe.challan_no),
           pe.party_name = COALESCE(ppi.party_name, pe.party_name),
           pe.item_id = COALESCE(ppi.item_id, pe.item_id),
           pe.material = COALESCE(ppi.material_description, pe.material),
           pe.updated_by = ?
       WHERE pe.planning_id = ? AND COALESCE(pe.row_type, 'entry') = 'entry'`,
      [req.user.id, id],
    );

    await connection.commit();
    const io = req.app.get("io");
    io?.emit("production_planning_updated", { action: "updated", id });
    io?.emit("production_updated", {
      action: "planning_details_synced",
      planning_id: id,
    });
    checkPlanningZincNotification({ planningId: id }).catch((error) => {
      console.error("Planning zinc notification failed:", error);
    });

    return res.json({
      success: true,
      message: "Production planning updated successfully",
      data: { id, challan_no: planningItems[0].challan_no },
    });
  } catch (error) {
    await connection.rollback();
    if (!error?.status) console.error("updateProductionPlanning:", error);
    return sendError(res, error, "Could not update production planning");
  } finally {
    connection.release();
  }
};

const deleteProductionPlanning = async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid production planning id",
      });
    }
    const [result] = await db.query(
      `UPDATE production_planning
       SET deleted_at = NOW(), updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [req.user.id, id],
    );
    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Production planning not found",
      });
    }

    await db.query(
      "UPDATE production_edit_grants peg JOIN production_entries pe ON pe.id = peg.production_entry_id SET peg.revoked_at = NOW() WHERE pe.planning_id = ? AND peg.used_at IS NULL AND peg.revoked_at IS NULL",
      [id],
    );
    await db.query(
      "UPDATE user_production_preferences SET default_planning_id = NULL WHERE default_planning_id = ?",
      [id],
    );
    req.app.get("io")?.emit("production_planning_updated", {
      action: "deleted",
      id,
    });
    return res.json({
      success: true,
      message: "Production planning deleted successfully",
    });
  } catch (error) {
    console.error("deleteProductionPlanning:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete production planning",
    });
  }
};

const getProductionPlanning = async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !["pending", "completed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be pending or completed",
      });
    }

    let query = `SELECT pp.*, fy.financial_year,
                        (pp.planned_qty - pp.completed_qty) AS remaining_qty,
                        creator.name AS created_by_name
                 FROM production_planning pp
                 LEFT JOIN financial_years fy ON fy.id = pp.financial_year_id
                 LEFT JOIN users creator ON creator.id = pp.created_by
                 WHERE pp.deleted_at IS NULL`;
    const params = [];
    if (status) {
      query += " AND pp.status = ?";
      params.push(status);
    }
    query += " ORDER BY pp.id DESC";
    const [rows] = await db.query(query, params);

    if (rows.length) {
      const [itemRows] = await db.query(
        `SELECT ppi.id, ppi.planning_id,
                COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
                COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
                ppi.item_id, ppi.material_detail, ppi.material_description, ppi.planned_qty,
                ppi.completed_qty, ppi.target_zinc_percentage,
                ppi.sequence_no, ppi.status, ppi.created_at, ppi.updated_at,
                COALESCE(i.item_name, ppi.material_description) AS item_name,
                (ppi.planned_qty - ppi.completed_qty) AS remaining_qty
         FROM production_planning_items ppi
         INNER JOIN production_planning pp ON pp.id = ppi.planning_id
         LEFT JOIN items i ON i.id = ppi.item_id
         WHERE ppi.planning_id IN (${rows.map(() => "?").join(", ")})
         ORDER BY ppi.planning_id, ppi.sequence_no`,
        rows.map((row) => row.id),
      );
      const itemsByPlanning = new Map();
      itemRows.forEach((item) => {
        const list = itemsByPlanning.get(Number(item.planning_id)) || [];
        list.push(item);
        itemsByPlanning.set(Number(item.planning_id), list);
      });
      rows.forEach((row) => {
        row.items = itemsByPlanning.get(Number(row.id)) || [];
        row.item_count = row.items.length;
      });
    }

    return res.json({
      success: true,
      message: "Production planning fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("getProductionPlanning:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load production planning",
    });
  }
};

const getAvailablePlanningDropdown = async (req, res) => {
  try {
    const active = await getActivePlanningItem(db);
    const data = active
      ? [
          {
            id: active.planning_id,
            planning_item_id: active.planning_item_id,
            challan_no: active.challan_no,
            party_name: active.party_name || "",
            material_description: active.material_description,
            planned_qty: active.planned_qty,
            completed_qty: active.completed_qty,
            remaining_qty: active.remaining_qty,
            target_zinc_percentage: active.target_zinc_percentage,
            sequence_no: active.sequence_no,
          },
        ]
      : [];
    return res.json({
      success: true,
      message: active
        ? "Current production flow fetched successfully"
        : "No pending production flow",
      data,
    });
  } catch (error) {
    console.error("getAvailablePlanningDropdown:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load production flow",
    });
  }
};

module.exports = {
  createProductionPlanning,
  deleteProductionPlanning,
  getAvailablePlanningDropdown,
  getProductionPlanning,
  updateProductionPlanning,
};
