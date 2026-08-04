const db = require("../config/db");

const parsePlannedQuantity = (value) => {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
};

const createProductionPlanning = async (req, res) => {
  try {
    const {
      challan_no,
      party_name,
      material_description,
      planned_qty,
      target_zinc_percentage,
      third_party_name,
    } = req.body;

    const plannedQuantity = parsePlannedQuantity(planned_qty);

    if (
      !challan_no ||
      !party_name ||
      !material_description ||
      !plannedQuantity
    ) {
      return res.status(400).json({
        success: false,
        message:
          "challan_no, party_name, material_description and planned_qty are required",
      });
    }

    const targetPercentage = target_zinc_percentage === "" || target_zinc_percentage == null
      ? null
      : Number(target_zinc_percentage);
    if (targetPercentage != null && (!Number.isFinite(targetPercentage) || targetPercentage <= 0 || targetPercentage > 100)) {
      return res.status(400).json({ success: false, message: "Target zinc percentage must be between 0 and 100" });
    }

    const [result] = await db.query(
      `
      INSERT INTO production_planning
      (
        challan_no,
        party_name,
        material_description,
        planned_qty,
        target_zinc_percentage,
        third_party_name,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        challan_no,
        party_name,
        material_description,
        planned_qty,
        targetPercentage,
        third_party_name || null,
        req.user.id,
      ],
    );

    const io = req.app.get("io");
    io.emit("production_planning_updated", {
      action: "created",
      id: result.insertId,
    });

    return res.status(201).json({
      success: true,
      message: "Production planning saved successfully",
      data: {
        id: result.insertId,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const updateProductionPlanning = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      challan_no,
      party_name,
      material_description,
      planned_qty,
      target_zinc_percentage,
      third_party_name,
      status,
    } = req.body;

    const plannedQuantity = parsePlannedQuantity(planned_qty);

    if (
      !challan_no ||
      !party_name ||
      !material_description ||
      !plannedQuantity
    ) {
      return res.status(400).json({
        success: false,
        message:
          "challan_no, party_name, material_description and planned_qty are required",
      });
    }

    const [existingRows] = await db.query(
      `SELECT completed_qty FROM production_planning WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Production planning not found",
      });
    }
    if (plannedQuantity < Number(existingRows[0].completed_qty)) {
      return res.status(409).json({
        success: false,
        message: `Planned quantity cannot be below the completed quantity (${Number(existingRows[0].completed_qty)} NOS)`,
      });
    }

    const targetPercentage = target_zinc_percentage === "" || target_zinc_percentage == null
      ? null
      : Number(target_zinc_percentage);
    if (targetPercentage != null && (!Number.isFinite(targetPercentage) || targetPercentage <= 0 || targetPercentage > 100)) {
      return res.status(400).json({ success: false, message: "Target zinc percentage must be between 0 and 100" });
    }

    const finalStatus = plannedQuantity <= Number(existingRows[0].completed_qty)
          ? "completed"
          : "pending";

    await db.query(
      `
      UPDATE production_planning
      SET
        challan_no = ?,
        party_name = ?,
        material_description = ?,
        planned_qty = ?,
        target_zinc_percentage = ?,
        third_party_name = ?,
        status = ?,
        updated_by = ?
      WHERE id = ?
      `,
      [
        challan_no,
        party_name,
        material_description,
        plannedQuantity,
        targetPercentage,
        third_party_name || null,
        finalStatus,
        req.user.id,
        id,
      ],
    );

    const io = req.app.get("io");
    io.emit("production_planning_updated", {
      action: "updated",
      id: Number(id),
    });

    return res.json({
      success: true,
      message: "Production planning updated successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const deleteProductionPlanning = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      `UPDATE production_planning
       SET deleted_at = NOW(), updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [req.user.id, id],
    );
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: "Production planning not found" });
    }

    await db.query(
      "UPDATE production_edit_grants peg JOIN production_entries pe ON pe.id=peg.production_entry_id SET peg.revoked_at=NOW() WHERE pe.planning_id=? AND peg.used_at IS NULL AND peg.revoked_at IS NULL",
      [id],
    );
    await db.query(
      "UPDATE user_production_preferences SET default_planning_id=NULL WHERE default_planning_id=?",
      [id],
    );

    const io = req.app.get("io");
    io.emit("production_planning_updated", {
      action: "deleted",
      id: Number(id),
    });

    return res.json({
      success: true,
      message: "Production planning deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getProductionPlanning = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT
        pp.*,
        (pp.planned_qty - pp.completed_qty) AS remaining_qty,
        creator.name AS created_by_name
      FROM production_planning pp
      LEFT JOIN users creator ON creator.id = pp.created_by
      WHERE pp.deleted_at IS NULL
    `;

    const params = [];

    if (status) {
      query += ` AND pp.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY pp.id DESC`;

    const [rows] = await db.query(query, params);

    return res.json({
      success: true,
      message: "Production planning fetched successfully",
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getAvailablePlanningDropdown = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT
        id,
        challan_no,
        party_name,
        material_description,
        planned_qty,
        completed_qty,
        (planned_qty - completed_qty) AS remaining_qty,
        third_party_name
      FROM production_planning
      WHERE status = 'pending'
      AND deleted_at IS NULL
      AND planned_qty > completed_qty
      ORDER BY challan_no ASC
      `,
    );

    return res.json({
      success: true,
      message: "Available planning fetched successfully",
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  createProductionPlanning,
  updateProductionPlanning,
  deleteProductionPlanning,
  getProductionPlanning,
  getAvailablePlanningDropdown,
};
