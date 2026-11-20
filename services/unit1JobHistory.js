const { snapshotInspection } = require('./unit1HoleReports');
const { physicalCoilCodeSql } = require('./unit1PhysicalCoils');

// Read the effective metadata stored with each bundle. Job corrections replace
// this metadata and recalculate derived records in the same transaction.
function historicalJobSql(sql) {
  const fields = { member_name: 'memberName', section_size: 'sectionSize', cut_length_mm: 'cutLengthMm', customer_name: 'customerName', project_name_capacity: 'projectNameCapacity', material_type: 'materialType', structure_type: 'structureType', shift: 'shift' };
  return sql.replace(/\bj\.(member_name|section_size|cut_length_mm|customer_name|project_name_capacity|material_type|structure_type|shift)\b/g, (_, column) => `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(b.job_snapshot,'$.${fields[column]}')),j.${column})`);
}

async function freezeJobHistory(connection, job) {
  await connection.execute(`UPDATE unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id
    SET b.job_snapshot=? WHERE r.job_card_id=? AND b.job_snapshot IS NULL`, [JSON.stringify(job), job.id]);
  const [checks] = await connection.execute(`SELECT hc.id,hc.check_type AS checkType,u.name AS checkedByName,
    r.coil_number AS coilNumber,m.name AS machineName,m.code AS machineCode,c.grade,c.material_type AS materialType,
    c.width_mm AS widthMm,c.thickness_mm AS thicknessMm,${physicalCoilCodeSql()} AS coilInternalId
    FROM unit1_hole_checks hc JOIN unit1_production_runs r ON r.id=hc.run_id
    JOIN unit1_machines m ON m.id=r.machine_id JOIN coils c ON c.id=r.coil_id LEFT JOIN users u ON u.id=hc.checked_by
    WHERE r.job_card_id=? AND hc.report_snapshot IS NULL`, [job.id]);
  for (const check of checks) {
    const [measurements] = await connection.execute(`SELECT h.id,h.punch_size AS punchSize,h.punch_name AS punchName,h.profile,h.target_mm AS targetMm,hm.measured_mm AS measuredMm
      FROM unit1_hole_check_measurements hm JOIN unit1_job_card_holes h ON h.id=hm.job_card_hole_id
      WHERE hm.check_id=? ORDER BY h.sequence_no`, [check.id]);
    const snapshot = snapshotInspection({ ...job, ...check, jobCardId: job.id, productType: job.structureType }, measurements, new Map(measurements.map(hole => [hole.id, Number(hole.measuredMm)])), { name: job.shift }, check.checkedByName);
    await connection.execute('UPDATE unit1_hole_checks SET report_snapshot=? WHERE id=? AND report_snapshot IS NULL', [JSON.stringify(snapshot), check.id]);
  }
}

function jobSpecificationChanged(job, value, oldHoles) {
  const numeric = ['cutLengthMm', 'coilWidthMm', 'coilThicknessMm'];
  const text = ['structureType', 'memberName', 'sectionSize', 'materialType', 'punchSize'];
  const holes = rows => JSON.stringify(rows.map(hole => [hole.punchName || null,hole.punchSize || job.punchSize, hole.profile, Number(hole.targetMm), hole.centerOffsetMm == null ? null : Number(hole.centerOffsetMm)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const sizes=require('./unit1AllowedCoilSizes').allowedCoilSizes;
  return JSON.stringify(sizes(job))!==JSON.stringify(sizes(value)) || numeric.some(key => Number(job[key]) !== Number(value[key])) || text.some(key => String(job[key]) !== String(value[key])) || holes(oldHoles) !== holes(value.holes);
}

module.exports = { historicalJobSql, freezeJobHistory, jobSpecificationChanged };
