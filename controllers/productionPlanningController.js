const db = require("../config/db");

const createProductionPlanning = async (req, res) => {
  try {
    const {
      challan_no,
      party_name,
      material_description,
      planned_qty,
      third_party_name,
    } = req.body;

    if (!challan_no || !party_name || !material_description || !planned_qty) {
      return res.status(400).json({
        success: false,
        message:
          "challan_no, party_name, material_description and planned_qty are required",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO production_planning
      (
        challan_no,
        party_name,
        material_description,
        planned_qty,
        third_party_name,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        challan_no,
        party_name,
        material_description,
        planned_qty,
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
      error: error.message,
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
      third_party_name,
      status,
    } = req.body;

    if (!challan_no || !party_name || !material_description || !planned_qty) {
      return res.status(400).json({
        success: false,
        message:
          "challan_no, party_name, material_description and planned_qty are required",
      });
    }

    await db.query(
      `
      UPDATE production_planning
      SET
        challan_no = ?,
        party_name = ?,
        material_description = ?,
        planned_qty = ?,
        third_party_name = ?,
        status = ?,
        updated_by = ?
      WHERE id = ?
      `,
      [
        challan_no,
        party_name,
        material_description,
        planned_qty,
        third_party_name || null,
        status || "pending",
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
      error: error.message,
    });
  }
};

const deleteProductionPlanning = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `
      UPDATE production_planning
      SET status = 'canceled',
          updated_by = ?
      WHERE id = ?
      `,
      [req.user.id, id],
    );

    const io = req.app.get("io");
    io.emit("production_planning_updated", {
      action: "canceled",
      id: Number(id),
    });

    return res.json({
      success: true,
      message: "Production planning canceled successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
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
      WHERE 1 = 1
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
      error: error.message,
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
      error: error.message,
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
