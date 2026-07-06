const db = require("../config/db");

// Indian financial year runs April -> March, e.g. 13/04/2026 -> "2026-27"
const getFinancialYearLabel = (dateInput) => {
  const date = new Date(dateInput);
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
};

const generateNextTcNo = async (inspectionDate) => {
  const fyLabel = getFinancialYearLabel(inspectionDate);
  const prefix = `IVS-HDGI-${fyLabel}-`;

  const [rows] = await db.query(
    `
    SELECT tc_no
    FROM coating_certificates
    WHERE tc_no LIKE ?
    ORDER BY id DESC
    LIMIT 1
    `,
    [`${prefix}%`],
  );

  let nextSeq = 1;

  if (rows.length > 0) {
    const lastSeq = Number(rows[0].tc_no.split("-").pop());
    if (Number.isFinite(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
};

const createCertificate = async (req, res) => {
  try {
    const {
      planning_id,
      structure,
      quantity,
      inspection_date,
      reference_standard,

      visual_check_result,
      visual_check_observation,
      adhesion_test_result,
      adhesion_test_observation,
      knife_test_result,
      knife_test_observation,
      mass_test_result,
      mass_test_observation,
      preece_test_result,
      preece_test_observation,

      remarks,
    } = req.body;

    if (!planning_id || !inspection_date || !reference_standard) {
      return res.status(400).json({
        success: false,
        message:
          "planning_id, inspection_date and reference_standard are required",
      });
    }

    const [planningRows] = await db.query(
      `SELECT * FROM production_planning WHERE id = ? LIMIT 1`,
      [planning_id],
    );

    if (planningRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Production planning not found",
      });
    }

    const planning = planningRows[0];

    let tcNo;
    let insertId;
    let attempts = 0;
    const maxAttempts = 3;

    // tc_no has a UNIQUE constraint - if two certificates get generated at the
    // same moment for the same financial year, retry with the next number
    // instead of failing the request.
    while (attempts < maxAttempts && !insertId) {
      attempts += 1;
      tcNo = await generateNextTcNo(inspection_date);

      try {
        const [result] = await db.query(
          `
          INSERT INTO coating_certificates
          (
            tc_no,
            planning_id,
            challan_no,
            party_name,
            third_party_name,
            structure,
            quantity,
            inspection_date,
            reference_standard,
            visual_check_result,
            visual_check_observation,
            adhesion_test_result,
            adhesion_test_observation,
            knife_test_result,
            knife_test_observation,
            mass_test_result,
            mass_test_observation,
            preece_test_result,
            preece_test_observation,
            remarks,
            created_by
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            tcNo,
            planning.id,
            planning.challan_no,
            planning.party_name,
            planning.third_party_name || null,
            structure || planning.material_description || null,
            quantity || String(planning.planned_qty || ""),
            inspection_date,
            reference_standard,
            visual_check_result || null,
            visual_check_observation || null,
            adhesion_test_result || null,
            adhesion_test_observation || null,
            knife_test_result || null,
            knife_test_observation || null,
            mass_test_result || null,
            mass_test_observation || null,
            preece_test_result || null,
            preece_test_observation || null,
            remarks || null,
            req.user.id,
          ],
        );

        insertId = result.insertId;
      } catch (error) {
        const isDuplicateTcNo = error.code === "ER_DUP_ENTRY";
        if (isDuplicateTcNo && attempts < maxAttempts) {
          continue;
        }
        throw error;
      }
    }

    if (!insertId) {
      return res.status(500).json({
        success: false,
        message: "Could not generate a unique certificate number, please retry",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Certificate created successfully",
      data: {
        id: insertId,
        tc_no: tcNo,
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

const getCertificates = async (req, res) => {
  try {
    const { planning_id, challan_no } = req.query;

    let query = `
      SELECT
        cc.*,
        creator.name AS created_by_name
      FROM coating_certificates cc
      LEFT JOIN users creator ON creator.id = cc.created_by
      WHERE 1 = 1
    `;
    const params = [];

    if (planning_id) {
      query += ` AND cc.planning_id = ?`;
      params.push(planning_id);
    }

    if (challan_no) {
      query += ` AND cc.challan_no = ?`;
      params.push(challan_no);
    }

    query += ` ORDER BY cc.id DESC`;

    const [rows] = await db.query(query, params);

    return res.json({
      success: true,
      message: "Certificates fetched successfully",
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

const getCertificateById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `
      SELECT
        cc.*,
        creator.name AS created_by_name
      FROM coating_certificates cc
      LEFT JOIN users creator ON creator.id = cc.created_by
      WHERE cc.id = ?
      `,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Certificate not found",
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

module.exports = {
  createCertificate,
  getCertificates,
  getCertificateById,
};
