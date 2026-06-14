const db = require("../config/db");

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
  const [rows] = await db.query(
    `
    SELECT *
    FROM shifts
    WHERE status = 'active'
    LIMIT 1
    `,
  );

  return rows.length > 0 ? rows[0] : null;
};

const saveProductionEntry = async (req, res) => {
  try {
    const {
      entry_type,
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

    const activeShift = await getActiveShift();

    if (!activeShift) {
      return res.status(400).json({
        success: false,
        message: "Please start shift before adding production",
      });
    }

    const [existingRows] = await db.query(
      `
      SELECT *
      FROM production_entries
      WHERE shift_id = ?
      AND sr_no = ?
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

      const zincPercentage = calculateZincPercentage(ms_weight, gi_weight);

      const productionWeight = calculateProductionWeight(
        dipping_qty,
        ms_weight,
      );

      const avgCoating = calculateAvgCoating([c1, c2, c3, c4, c5]);

      if (existingRow) {
        await db.query(
          `
      UPDATE production_entries
      SET
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
            challan_no,
            party_name,
            material,
            production_time || null,
            dipping_qty || 0,
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

        io.emit("production_updated", {
          action: "full_updated",
          type: "updated",
          shift_id: activeShift.id,
          shift_date: activeShift.shift_date,
          shift_name: activeShift.shift_name,
          sr_no: Number(sr_no),
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

      const [lastRows] = await db.query(
        `
    SELECT sr_no, material, row_type
    FROM production_entries
    WHERE shift_id = ?
    ORDER BY sr_no DESC
    LIMIT 1
    `,
        [activeShift.id],
      );

      const lastRow = lastRows[0];

      let createdSummaryRow = null;

      if (
        lastRow &&
        lastRow.row_type === "entry" &&
        lastRow.material &&
        material &&
        lastRow.material.toLowerCase() !== material.toLowerCase()
      ) {
        createdSummaryRow = await createMaterialSummaryRow({
          connection: db,
          shiftId: activeShift.id,
          shiftDate: activeShift.shift_date,
          shiftName: activeShift.shift_name,
          material: lastRow.material,
          createdBy: req.user.id,
        });
      }

      const [nextSrRows] = await db.query(
        `
    SELECT COALESCE(MAX(sr_no), 0) + 1 AS next_sr_no
    FROM production_entries
    WHERE shift_id = ?
    `,
        [activeShift.id],
      );

      const nextSrNo = nextSrRows[0].next_sr_no;

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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entry', ?)
    `,
        [
          activeShift.id,
          activeShift.shift_date,
          activeShift.shift_name,
          nextSrNo,
          challan_no,
          party_name,
          material,
          production_time || null,
          dipping_qty || 0,
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

      io.emit("production_updated", {
        action: "full_created",
        type: "created",
        production_id: result.insertId,
        summary_row: createdSummaryRow,
        shift_id: activeShift.id,
        shift_date: activeShift.shift_date,
        shift_name: activeShift.shift_name,
        sr_no: Number(nextSrNo),
      });

      return res.status(201).json({
        success: true,
        action: "created",
        message: "Production entry created successfully",
        data: {
          production_id: result.insertId,
          sr_no: nextSrNo,
          summary_row: createdSummaryRow,
          zinc_percentage: zincPercentage,
          production_weight: productionWeight,
          avg_coating: avgCoating,
        },
      });
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
      error: error.message,
    });
  }
};

const getProductions = async (req, res) => {
  try {
    const {
      shift_date,
      shift_name,
      shift_id,
      page = 1,
      limit = 50,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

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

    query += ` ORDER BY production_entries.sr_no ASC LIMIT ? OFFSET ?`;
    params.push(Number(limit), offset);

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
      error: error.message,
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
      error: error.message,
    });
  }
};

const deleteProduction = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      `
      DELETE FROM production_entries
      WHERE id = ?
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Production entry not found",
      });
    }

    return res.json({
      success: true,
      message: "Production entry deleted successfully",
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
  saveProductionEntry,
  getProductions,
  getProductionById,
  deleteProduction,
};
