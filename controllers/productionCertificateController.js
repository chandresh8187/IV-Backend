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

const getCertificateReadings = async (req, res) => {
  try {
    const planningId = Number(req.query.planning_id);
    const minimumInput = String(req.query.minimum ?? "").trim();
    const maximumInput = String(req.query.maximum ?? "").trim();
    const hasMinimum = minimumInput !== "";
    const hasMaximum = maximumInput !== "";

    if (!Number.isInteger(planningId) || planningId < 1) {
      return res.status(400).json({
        success: false,
        message: "planning_id must be a positive whole number",
      });
    }

    if (hasMinimum !== hasMaximum) {
      return res.status(400).json({
        success: false,
        message: "Enter both minimum and maximum coating values",
      });
    }

    const minimum = hasMinimum ? Number(minimumInput) : 80;
    const maximum = hasMaximum ? Number(maximumInput) : null;

    if (
      !Number.isFinite(minimum) ||
      minimum < 0 ||
      (maximum != null && (!Number.isFinite(maximum) || maximum < 0))
    ) {
      return res.status(400).json({
        success: false,
        message: "Coating range values must be valid positive numbers",
      });
    }

    if (maximum != null && minimum > maximum) {
      return res.status(400).json({
        success: false,
        message: "Minimum coating cannot be greater than maximum coating",
      });
    }

    const averageExpression = `COALESCE(
      NULLIF(pe.avg_coating, 0),
      (pe.c1 + pe.c2 + pe.c3 + pe.c4 + pe.c5) / 5
    )`;
    const rangeCondition = maximum == null
      ? `${averageExpression} >= ?`
      : `${averageExpression} BETWEEN ? AND ?`;
    const rangeParams = maximum == null ? [minimum] : [minimum, maximum];
    const baseWhere = `(pe.planning_id = ? OR (
        pe.planning_id IS NULL
        AND pe.challan_no = (
          SELECT challan_no
          FROM production_planning
          WHERE id = ? AND deleted_at IS NULL
          LIMIT 1
        )
      ))
      AND COALESCE(pe.row_type, 'entry') = 'entry'
      AND pe.c1 > 0
      AND pe.c2 > 0
      AND pe.c3 > 0
      AND pe.c4 > 0
      AND pe.c5 > 0
      AND ${rangeCondition}`;
    const params = [planningId, planningId, ...rangeParams];

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS matching_count
       FROM production_entries pe
       WHERE ${baseWhere}`,
      params,
    );
    const [rows] = await db.query(
      `SELECT
         pe.id,
         pe.sr_no,
         DATE_FORMAT(pe.shift_date, '%Y-%m-%d') AS shift_date,
         pe.shift_name,
         pe.c1,
         pe.c2,
         pe.c3,
         pe.c4,
         pe.c5,
         ROUND(${averageExpression}, 2) AS avg_coating
       FROM production_entries pe
       WHERE ${baseWhere}
       ORDER BY RAND()
       LIMIT 10`,
      params,
    );

    return res.json({
      success: true,
      message: "Certificate coating readings selected successfully",
      data: {
        readings: rows,
        matching_count: Number(countRow?.matching_count) || 0,
        selected_count: rows.length,
        minimum,
        maximum,
        used_default_range: !hasMinimum,
      },
    });
  } catch (error) {
    console.error("getCertificateReadings:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load certificate coating readings",
    });
  }
};

const createCertificate = async (req, res) => {
  try {
    const {
      planning_id,
      structure,
      quantity,
      inspection_date,
      reference_standard,
      coating_readings,

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
      `SELECT * FROM production_planning WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
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
            coating_readings_json,
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            JSON.stringify(Array.isArray(coating_readings) ? coating_readings.slice(0, 10) : []),
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

    req.app.get("io")?.emit("certificate_updated", {
      action: "created",
      certificate_id: insertId,
      planning_id: Number(planning_id),
    });

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
    });
  }
};

module.exports = {
  createCertificate,
  getCertificateReadings,
  getCertificates,
  getCertificateById,
};
