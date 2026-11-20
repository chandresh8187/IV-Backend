const { newestInspectionsFirst } = require('./unit1InspectionOrder');
const { physicalCoilCodeSql } = require('./unit1PhysicalCoils');
const { DateTime } = require('luxon');
const crypto = require('crypto');
const { validatePieceInspection, validateRejectedPieces } = require('./unit1PieceInspection');
const { validateRejectedLines } = require('./unit1RejectedLines');
const fail = message => Object.assign(new Error(message), { status: 400 });

function validateInspection(body) {
  const rejectionOnly = body?.entryKind === 'rejection';
  if (body?.entryKind != null && !['inspection','rejection'].includes(body.entryKind)) throw fail('Invalid entry type.');
  if (!Array.isArray(body?.measurements) || body.measurements.length > 2000 || body.approved !== true) throw fail('Record every hole measurement and confirm approval.');
  const hasPiece = body.measuredCutLengthMm != null || body.measuredSectionSize != null;
  const piece = hasPiece ? validatePieceInspection(body) : null;
  const rejectedLines = body.rejectedLines === undefined ? null : validateRejectedLines(body.rejectedLines);
  const suppliedPieces = validateRejectedPieces(body.rejectedPieces);
  const rejectedPieces = rejectedLines ? rejectedLines.reduce((sum, line) => sum + line.pieces, 0) : suppliedPieces;
  if (rejectedLines && suppliedPieces != null && suppliedPieces !== rejectedPieces) throw fail('Rejected total must match the cut-length lines.');
  if (!rejectionOnly && !body.measurements.length && !piece) throw fail('Record the first-piece dimensions and confirm approval.');
  if (rejectionOnly && (!(rejectedPieces > 0) || body.measurements.length || hasPiece)) throw fail('Enter rejected pieces only, as a positive whole number.');
  const remarks = String(body.remarks ?? '').trim();
  if (remarks.length > 1000) throw fail('Remarks must be 1000 characters or fewer.');
  const requestKey = body.requestKey == null ? null : String(body.requestKey);
  if (requestKey !== null && !/^[A-Za-z0-9_-]{8,80}$/.test(requestKey)) throw fail('Invalid inspection request key.');
  if(rejectedPieces>0&&!requestKey)throw fail('Reopen the inspection form before recording rejected pieces.');
  const seen = new Set();
  const measurements = body.measurements.map(item => {
    const holeId = Number(item?.holeId), value = String(item?.measuredMm ?? '').trim();
    if (!Number.isSafeInteger(holeId) || holeId <= 0 || seen.has(holeId) || !/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 1000000) throw fail('Enter a valid measurement from 0 to 1000000 mm, with up to two decimal places, for every hole.');
    seen.add(holeId);
    return { holeId, measuredMm: Number(value) };
  });
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ ...(rejectionOnly ? {entryKind:'rejection'} : {}), remarks, measurements: [...measurements].sort((a, b) => a.holeId - b.holeId), ...(piece ? {piece} : {}), ...(rejectedPieces == null ? {} : {rejectedPieces}), ...(rejectedLines ? {rejectedLines} : {}) })).digest('hex');
  return { remarks, requestKey, requestHash, measurements, piece, rejectedPieces, rejectedLines, rejectionOnly };
}

function snapshotInspection(run, holes, submitted, shift, checkedByName) {
  return {
    machineName: run.machineName, machineCode: run.machineCode, jobCardId: run.jobCardId,planningId:run.planningId,templateId:run.templateId,
    sectionSize: run.sectionSize, cutLengthMm: run.cutLengthMm, memberName: run.memberName,
    ...(run.sectionProfile ? { sectionProfile: run.sectionProfile } : {}),
    profileType: run.productType, grade: run.grade, materialType: run.materialType,
    coilSize: `${run.widthMm} x ${run.thicknessMm} mm`, coilNumber: run.coilNumber,
    coilInternalId: run.coilInternalId, customerName: run.customerName,
    projectName: run.projectNameCapacity, shift: shift.name, shiftDate: shift.shiftDate,
    checkedByName,
    measurements: holes.map((hole, index) => ({
      holeId: hole.id ?? hole.holeId, sequenceNo: index + 1, punchName: require("./unit1PunchNames").punchNameFor(hole,holes,run.punchSize)||null, punchLetter: require("./unit1PunchNames").punchNameFor(hole,holes,run.punchSize)||"Legacy",
      punchSize: hole.punchSize || run.punchSize, profile: hole.profile,
      targetMm: Number(hole.targetMm), measuredMm: submitted.get(hole.id ?? hole.holeId),
    })),
  };
}

function reportDateRange(rawDate) {
  const date = String(rawDate ?? DateTime.now().setZone('Asia/Kolkata').toISODate());
  const start = DateTime.fromISO(date, { zone: 'Asia/Kolkata' }).startOf('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !start.isValid || start.toISODate() !== date) throw fail('Choose a valid inspection date (YYYY-MM-DD).');
  // checked_at uses CURRENT_TIMESTAMP in the Unit 1 +05:30 database session.
  return { date, start: start.toFormat('yyyy-MM-dd HH:mm:ss'), end: start.plus({ days: 1 }).toFormat('yyyy-MM-dd HH:mm:ss') };
}

const inspectionOperatingDateSql = alias => "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT("+alias+".report_snapshot,'$.shiftDate')),'null'),DATE("+alias+".checked_at))";

async function dailyMachineInspectionProgress(db, day) {
  const [rows] = await db.execute(`
    SELECT r.machine_id AS machineId, COUNT(*) AS completed
    FROM unit1_hole_checks hc
    JOIN unit1_production_runs r ON r.id=hc.run_id
    WHERE ${inspectionOperatingDateSql('hc')}=?
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.entryKind')), 'inspection') <> 'rejection'
    GROUP BY r.machine_id
  `, [day]);
  return { day, target: 3, machines: rows.map(row => ({ machineId: row.machineId, completed: Number(row.completed) })) };
}
async function machineHoleReport(db, { machineId, date, page = 1, pdf = false, activeShift, operatingDate=false,shift='all',entryKind='all' }) {
  if(!['all','day','night'].includes(shift)||!Number.isSafeInteger(Number(page))||Number(page)<1||(machineId!=null&&(!/^\d+$/.test(String(machineId))||Number(machineId)<1)))throw fail('Invalid inspection history filters.');
  const range = activeShift ? {date:activeShift.shiftDate,start:DateTime.fromISO(activeShift.startsAt).setZone('Asia/Kolkata').toFormat('yyyy-MM-dd HH:mm:ss'),end:DateTime.fromISO(activeShift.endsAt).setZone('Asia/Kolkata').toFormat('yyyy-MM-dd HH:mm:ss')} : reportDateRange(date);
  const [[machine]] = machineId ? await db.execute('SELECT id,name,code FROM unit1_machines WHERE id=?', [machineId]) : [[{ name: 'All machines', code: 'ALL' }]];
  if (!machine) throw Object.assign(new Error('Machine not found.'), { status: 404 });
  const params=machineId?[machineId]:[];
  const conditions=machineId?['r.machine_id=?']:[];
  if(operatingDate){conditions.push(inspectionOperatingDateSql('hc')+'=?');params.push(range.date);}else{conditions.push('hc.checked_at>=? AND hc.checked_at<?');params.push(range.start,range.end);}
  if(shift!=='all'){conditions.push("COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.shift')),'null'),(SELECT shift FROM unit1_job_cards WHERE id=r.job_card_id))=?");params.push(shift);}
  if (!['all','inspection','rejection'].includes(entryKind)) throw fail('Invalid entry type.');
  if (entryKind==='rejection') conditions.push("CAST(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.rejectedPieces')) AS UNSIGNED)>0");
  if (entryKind==='inspection') conditions.push("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.entryKind')),'inspection')<>'rejection'");
  const condition=conditions.join(' AND ');
  const where = `FROM unit1_hole_checks hc JOIN unit1_production_runs r ON r.id=hc.run_id WHERE ${condition}`;
  const [[count]] = await db.execute(`SELECT COUNT(*) AS total ${where}`, params);
  if (pdf && Number(count.total) > 200) throw Object.assign(new Error('More than 200 inspections on this date. Contact your administrator to export this report.'), { status: 400 });
  const size = pdf ? 200 : 20, offset = pdf ? 0 : (page - 1) * size;
  const [rows] = await db.query(`SELECT hc.id,r.machine_id AS machineId,m.name AS machineName,m.code AS machineCode,hc.run_id AS runId,hc.check_type AS checkType,hc.checked_at AS checkedAt,hc.remarks,hc.report_snapshot AS reportSnapshot,
    u.name AS checkedByName,r.job_card_id AS jobCardId,(SELECT pl.plan_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=r.job_card_id) AS planningId,(SELECT pl.template_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=r.job_card_id) AS templateId,r.coil_id AS coilId,r.coil_number AS coilNumber,j.section_size AS sectionSize,j.cut_length_mm AS cutLengthMm,j.member_name AS memberName,
    j.structure_type AS profileType,j.customer_name AS customerName,j.shift,c.grade,c.material_type AS materialType,c.width_mm AS widthMm,c.thickness_mm AS thicknessMm,${physicalCoilCodeSql()} AS coilInternalId
    FROM unit1_hole_checks hc JOIN unit1_production_runs r ON r.id=hc.run_id JOIN unit1_machines m ON m.id=r.machine_id LEFT JOIN users u ON u.id=hc.checked_by
    LEFT JOIN unit1_job_cards j ON j.id=r.job_card_id JOIN coils c ON c.id=r.coil_id
    WHERE ${condition} ORDER BY hc.checked_at DESC,hc.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  const ids = rows.filter(row => !row.reportSnapshot).map(row => row.id);
  const [legacy] = ids.length ? await db.query(`SELECT hm.check_id AS checkId,h.id AS holeId,h.sequence_no AS sequenceNo,COALESCE(h.punch_size,j.punch_size) AS punchSize,h.punch_name AS punchName,h.profile,h.target_mm AS targetMm,hm.measured_mm AS measuredMm
    FROM unit1_hole_check_measurements hm JOIN unit1_job_card_holes h ON h.id=hm.job_card_hole_id JOIN unit1_job_cards j ON j.id=h.job_card_id WHERE hm.check_id IN (${ids.map(() => '?').join(',')}) ORDER BY h.sequence_no`, ids) : [[]];
  const checks = rows.map(({ reportSnapshot, ...row }) => {
    if (reportSnapshot) return { ...row, ...JSON.parse(reportSnapshot), coilInternalId: row.coilInternalId, id: row.id, checkedAt: row.checkedAt, checkType: row.checkType, remarks: row.remarks };
    const holes = legacy.filter(hole => hole.checkId === row.id);
    return { ...row, ...snapshotInspection({ ...row, productType: row.profileType, machineName: row.machineName || machine.name, machineCode: row.machineCode || machine.code }, holes, new Map(holes.map(hole => [hole.holeId, Number(hole.measuredMm)])), { name: row.shift }, row.checkedByName), legacy: true };
  });
  return { machine, date: range.date, shift, checks: newestInspectionsFirst(checks), total: Number(count.total), page, pageSize: size };
}
module.exports = { validateInspection, snapshotInspection, reportDateRange, machineHoleReport, inspectionOperatingDateSql, dailyMachineInspectionProgress };
