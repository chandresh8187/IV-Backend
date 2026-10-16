const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { PRODUCTS, positiveId, validateOutput } = require('../services/unit1ProductionValidation');
const { coilMatchesJob } = require('../services/unit1CoilMatch');
const jobCardRoutes = require('./unit1JobCardRoutes');
const { publishUnit1Change } = require('../services/unit1Realtime');
const { getSchedule, currentShift } = require('../services/unit1ShiftService');
const { theoreticalWeightKg, holeScrapKg, roundKg } = require('../services/unit1MaterialWeight');

const runColumns = `r.id, r.machine_id AS machineId, m.code AS machineCode, m.name AS machineName,
  r.coil_id AS coilId, r.coil_number AS coilNumber, c.internal_id AS coilInternalId,
  c.invoice, c.material_type AS materialType, c.grade, c.width_mm AS widthMm,
  c.thickness_mm AS thicknessMm, c.coil_qty AS coilQty, c.actual_net_kg AS coilBatchWeightKg,
  r.job_card_id AS jobCardId, j.member_name AS memberName, j.section_size AS sectionSize,
  j.customer_name AS customerName, j.project_name_capacity AS projectNameCapacity,
  j.production_qty AS productionQty, j.shift, j.cut_length_mm AS cutLengthMm,
  j.punch_size AS punchSize, r.hole_checked_at AS holeCheckedAt,
  r.hole_checked_by AS holeCheckedBy, r.product_type AS productType, r.status,
  r.produced_pieces AS producedPieces,
  (SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_bundles b WHERE b.run_id=r.id) AS theoreticalUsedKg,
  (SELECT CASE WHEN COUNT(*)<>COUNT(b.hole_scrap_kg) THEN NULL ELSE COALESCE(SUM(b.hole_scrap_kg),0) END FROM unit1_production_bundles b WHERE b.run_id=r.id) AS holeScrapKg,
  (SELECT density_g_cm3 FROM unit1_material_densities d WHERE d.material_type=c.material_type) AS densityGcm3,
  r.run_seconds AS runSeconds, r.started_at AS startedAt, r.last_resumed_at AS lastResumedAt,
  r.completed_at AS completedAt, r.created_by AS createdBy, r.updated_at AS updatedAt`;

const runJoin = 'FROM unit1_production_runs r JOIN unit1_machines m ON m.id = r.machine_id JOIN coils c ON c.id = r.coil_id LEFT JOIN unit1_job_cards j ON j.id = r.job_card_id';
const httpError = (status, message) => Object.assign(new Error(message), { status });
const labourMachine = req => req.user.role === 'labour' ? Number(req.user.assignedMachineId) || 0 : null;
const requireMachine = (req, machineId) => {
  const assigned = labourMachine(req);
  if (assigned !== null && assigned !== Number(machineId)) throw httpError(403, 'This machine is not assigned to you.');
};

async function getRun(id) {
  const [rows] = await db.execute(`SELECT ${runColumns} ${runJoin} WHERE r.id = ?`, [id]);
  return rows[0] ? withWeight(rows[0]) : null;
}

function withWeight(run) {
  const startingKg = Number(run.coilBatchWeightKg) / Number(run.coilQty || 1);
  const usedKg = Number(run.theoreticalUsedKg || 0);
  return { ...run, perCoilStartingKg: roundKg(startingKg), theoreticalUsedKg: roundKg(usedKg), theoreticalRemainingKg: roundKg(startingKg - usedKg), holeScrapKg: run.holeScrapKg === null ? null : roundKg(run.holeScrapKg) };
}

async function inTransaction(work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

function publish(req, runId, action) {
  publishUnit1Change(req, 'production', { runId, action });
}

router.use(auth);
router.use((req, res, next) => {
  if (req.user.role !== 'labour') return next();
  const allowedRead = req.method === 'GET' && (req.path === '/live' || req.path === '/job-cards' || /^\/machines\/\d+\/entries$/.test(req.path));
  const allowedEntry = req.method === 'POST' && /^\/runs\/\d+\/bundles$/.test(req.path);
  return allowedRead || allowedEntry ? next() : res.status(403).json({ error: 'Labour users can only view their assigned machine and add production entries.' });
});
router.use('/job-cards', jobCardRoutes);

router.get('/live', access([], 'unit1.production.view'), async (req, res, next) => {
  try {
    const activeShift = currentShift(await getSchedule());
    const [[machines], [runs]] = await Promise.all([
      db.query('SELECT id, code, name, is_active AS isActive FROM unit1_machines ORDER BY name'),
      db.query(`SELECT ${runColumns} ${runJoin} WHERE r.status IN ('setup','running','paused') ORDER BY r.started_at DESC`),
    ]);
    const assigned = labourMachine(req);
    const visibleMachines = assigned === null ? machines : machines.filter(machine => Number(machine.id) === assigned);
    const visibleRuns = assigned === null ? runs : runs.filter(run => Number(run.machineId) === assigned);
    const runIds = visibleRuns.map(run => run.id);
    const [checks] = runIds.length ? await db.query(`SELECT h.job_card_id AS jobCardId, hc.run_id AS runId, h.profile, h.target_mm AS targetMm, hc.measured_mm AS measuredMm FROM unit1_run_hole_checks hc JOIN unit1_job_card_holes h ON h.id=hc.job_card_hole_id WHERE hc.run_id IN (${runIds.map(() => '?').join(',')}) ORDER BY h.sequence_no`, runIds) : [[]];
    res.json({ data: { products: PRODUCTS, machines: visibleMachines.map(machine => ({ ...machine, isActive: Boolean(machine.isActive) })), runs: visibleRuns.map(run => ({ ...withWeight(run), holeChecks: checks.filter(check => check.runId === run.id) })), activeShift, serverTime: new Date().toISOString() } });
  } catch (error) { next(error); }
});

router.get('/available-coils', access([], 'unit1.production.view'), async (req, res, next) => {
  if (req.user.role === 'labour') return res.status(403).json({ error: 'Coil stock is unavailable to Labour users.' });
  try {
    const [rows] = await db.query(`SELECT c.id, c.internal_id AS internalId, c.invoice,
      c.material_type AS materialType, c.grade, c.width_mm AS widthMm, c.thickness_mm AS thicknessMm,
      c.coil_qty AS coilQty, c.actual_net_kg AS totalWeightKg, COUNT(r.id) AS usedQty
      FROM coils c LEFT JOIN unit1_production_runs r ON r.coil_id = c.id
      WHERE c.status IN ('in_stock','allocated')
      GROUP BY c.id HAVING usedQty < c.coil_qty ORDER BY c.received_at DESC, c.id DESC`);
    res.json({ data: rows.map(row => ({ ...row, availableQty: Number(row.coilQty) - Number(row.usedQty) })) });
  } catch (error) { next(error); }
});

router.get('/available-coils/:id/used', access([], 'unit1.production.view'), async (req, res, next) => {
  if (req.user.role === 'labour') return res.status(403).json({ error: 'Coil stock is unavailable to Labour users.' });
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid coil ID.' });
  try {
    const [rows] = await db.execute('SELECT coil_number AS coilNumber FROM unit1_production_runs WHERE coil_id = ? ORDER BY coil_number', [id]);
    res.json({ data: rows.map(row => row.coilNumber) });
  } catch (error) { next(error); }
});

router.post('/verify-coil', access([], 'unit1.production.coil.assign'), async (req, res, next) => {
  const jobCardId = positiveId(req.body?.jobCardId);
  const coilId = positiveId(req.body?.coilId);
  const coilNumber = positiveId(req.body?.coilNumber);
  if (!jobCardId || !coilId || !coilNumber) return res.status(400).json({ error: 'Scan a numbered coil for an assigned job card.' });
  try {
    const [[[job]], [[coil]], [used]] = await Promise.all([
      db.execute('SELECT id,status,machine_id AS machineId,material_type AS materialType,coil_width_mm AS coilWidthMm,coil_thickness_mm AS coilThicknessMm FROM unit1_job_cards WHERE id=?', [jobCardId]),
      db.execute('SELECT id,status,qr_generated_at AS qrGeneratedAt,coil_qty AS coilQty,material_type AS materialType,width_mm AS widthMm,thickness_mm AS thicknessMm FROM coils WHERE id=?', [coilId]),
      db.execute('SELECT id FROM unit1_production_runs WHERE coil_id=? AND coil_number=? LIMIT 1', [coilId, coilNumber]),
    ]);
    if (!job || job.status !== 'open' || !job.machineId) return res.status(409).json({ error: 'Assign an open job card to a machine first.' });
    if (!coil || !coil.qrGeneratedAt || !['in_stock','allocated'].includes(coil.status) || coilNumber > coil.coilQty || used.length) return res.status(409).json({ error: 'This numbered coil is not available for production.' });
    if (!coilMatchesJob(coil, job)) return res.status(409).json({ error: 'Incorrect coil for current job card. Material, width and thickness must match.' });
    res.json({ data: { compatible: true, jobCardId, coilId, coilNumber } });
  } catch (error) { next(error); }
});

router.get('/runs', access([], 'unit1.production.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT ${runColumns} ${runJoin} ORDER BY r.id DESC LIMIT 100`);
    const assigned = labourMachine(req);
    res.json({ data: (assigned === null ? rows : rows.filter(run => Number(run.machineId) === assigned)).map(withWeight) });
  } catch (error) { next(error); }
});

router.get('/history/dates', access([], 'unit1.production.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT DATE_FORMAT(COALESCE(b.shift_date, DATE(b.created_at)), '%Y-%m-%d') AS shiftDate,
      COUNT(*) AS entryCount, COALESCE(SUM(b.pieces),0) AS pieces
      FROM unit1_production_bundles b GROUP BY COALESCE(b.shift_date, DATE(b.created_at))
      ORDER BY shiftDate DESC LIMIT 366`);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/history', access([], 'unit1.production.view'), async (req, res, next) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return res.status(400).json({ error: 'A valid production date is required.' });
  const shift = String(req.query.shift || 'all').toLowerCase();
  if (!['all', 'day', 'night'].includes(shift)) return res.status(400).json({ error: 'Invalid shift.' });
  const machineId = req.query.machineId ? positiveId(req.query.machineId) : null;
  if (req.query.machineId && !machineId) return res.status(400).json({ error: 'Invalid machine ID.' });
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const pageSize = 50;
  const where = ['COALESCE(b.shift_date, DATE(b.created_at))=?'];
  const params = [date];
  if (shift !== 'all') { where.push('COALESCE(b.shift,j.shift)=?'); params.push(shift); }
  if (machineId) { where.push('r.machine_id=?'); params.push(machineId); }
  const source = `FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id
    JOIN unit1_job_cards j ON j.id=r.job_card_id JOIN unit1_machines m ON m.id=r.machine_id
    JOIN coils c ON c.id=r.coil_id`;
  const condition = `WHERE ${where.join(' AND ')}`;
  try {
    const [[totals], [shifts], [materials], [jobCards], [customers], [entries]] = await Promise.all([
      db.execute(`SELECT COUNT(*) AS entryCount, COALESCE(SUM(b.pieces),0) AS pieces,
        COALESCE(SUM(b.theoretical_used_kg),0) AS estimatedUsedKg,
        CASE WHEN COUNT(*)<>COUNT(b.hole_scrap_kg) THEN NULL ELSE COALESCE(SUM(b.hole_scrap_kg),0) END AS holeScrapKg
        ${source} ${condition}`, params),
      db.execute(`SELECT COALESCE(b.shift,j.shift) AS shift, COUNT(*) AS entryCount, SUM(b.pieces) AS pieces,
        SUM(b.theoretical_used_kg) AS estimatedUsedKg ${source} ${condition}
        GROUP BY COALESCE(b.shift,j.shift) ORDER BY shift`, params),
      db.execute(`SELECT c.material_type AS materialType, COUNT(*) AS entryCount, SUM(b.pieces) AS pieces,
        SUM(b.theoretical_used_kg) AS estimatedUsedKg ${source} ${condition}
        GROUP BY c.material_type ORDER BY pieces DESC`, params),
      db.execute(`SELECT j.id AS jobCardId,j.member_name AS memberName,j.customer_name AS customerName,
        j.project_name_capacity AS projectName,m.name AS machineName,
        COUNT(*) AS entryCount,SUM(b.pieces) AS pieces,SUM(b.theoretical_used_kg) AS estimatedUsedKg
        ${source} ${condition} GROUP BY j.id,j.member_name,j.customer_name,j.project_name_capacity,m.name
        ORDER BY pieces DESC`, params),
      db.execute(`SELECT j.customer_name AS customerName,COUNT(*) AS entryCount,
        SUM(b.pieces) AS pieces,SUM(b.theoretical_used_kg) AS estimatedUsedKg
        ${source} ${condition} GROUP BY j.customer_name ORDER BY pieces DESC`, params),
      db.execute(`SELECT b.id,b.run_id AS runId,b.bundle_no AS bundleNo,b.pieces,
        b.theoretical_used_kg AS theoreticalUsedKg,b.hole_scrap_kg AS holeScrapKg,
        b.hole_check_id AS holeCheckId,b.created_at AS createdAt,
        COALESCE(b.shift,j.shift) AS shift,b.shift_date AS shiftDate,
        j.id AS jobCardId,j.member_name AS memberName,j.section_size AS sectionSize,
        j.cut_length_mm AS cutLengthMm,j.customer_name AS customerName,
        j.project_name_capacity AS projectName,j.material_type AS materialType,
        m.id AS machineId,m.name AS machineName,m.code AS machineCode,
        c.id AS coilId,c.internal_id AS coilInternalId,r.coil_number AS coilNumber,
        u.name AS enteredByName,b.entered_by AS enteredBy
        ${source} LEFT JOIN users u ON u.id=b.entered_by ${condition}
        ORDER BY b.created_at DESC,b.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
    ]);
    res.json({ data: { date, shift, machineId, summary: totals[0], shifts, materials, jobCards, customers, entries, total: Number(totals[0].entryCount), page, pageSize } });
  } catch (error) { next(error); }
});

router.get('/machines/:machineId/entries', access([], 'unit1.production.view'), async (req, res, next) => {
  const machineId = positiveId(req.params.machineId);
  if (!machineId) return res.status(400).json({ error: 'Invalid machine ID.' });
  try { requireMachine(req, machineId); } catch (error) { return next(error); }
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const pageSize = 50;
  try {
    const activeShift = currentShift(await getSchedule());
    const [[activeJob]] = await db.execute("SELECT id,member_name AS memberName FROM unit1_job_cards WHERE machine_id=? AND status='open' AND archived_at IS NULL ORDER BY id DESC LIMIT 1", [machineId]);
    const where = 'r.machine_id=? AND b.shift_date=? AND b.shift=?';
    const params = [machineId, activeShift.shiftDate, activeShift.name];
    const [[count]] = await db.execute(`SELECT COUNT(*) AS total FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id WHERE ${where}`, params);
    const [entries] = await db.execute(`SELECT b.id,b.run_id AS runId,b.bundle_no AS bundleNo,b.pieces,b.theoretical_used_kg AS theoreticalUsedKg,b.hole_scrap_kg AS holeScrapKg,b.density_g_cm3 AS densityGcm3,b.hole_check_id AS holeCheckId,
      b.created_at AS createdAt,b.entered_by AS enteredBy,u.name AS enteredByName,
      j.id AS jobCardId,j.member_name AS memberName,j.section_size AS sectionSize,
      j.cut_length_mm AS cutLengthMm,j.customer_name AS customerName,j.project_name_capacity AS projectName,
      COALESCE(b.shift,j.shift) AS shift,b.shift_date AS shiftDate,j.material_type AS materialType,
      c.id AS coilId,c.internal_id AS coilInternalId,r.coil_number AS coilNumber
      FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id
      JOIN unit1_job_cards j ON j.id=r.job_card_id JOIN coils c ON c.id=r.coil_id
      LEFT JOIN users u ON u.id=b.entered_by WHERE ${where} ORDER BY b.created_at ASC,b.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
    res.json({ data: { entries, total: Number(count.total), page, pageSize, activeShift, activeJobCard: activeJob || null } });
  } catch (error) { next(error); }
});

router.get('/hole-checks/:id', access([], 'unit1.production.view'), async (req, res, next) => {
  if (req.user.role === 'labour') return res.status(403).json({ error: 'Hole checks are unavailable to Labour users.' });
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid hole check ID.' });
  try {
    const [[check]] = await db.execute(`SELECT c.id,c.run_id AS runId,c.check_type AS checkType,c.checked_at AS checkedAt,
      u.name AS checkedByName FROM unit1_hole_checks c LEFT JOIN users u ON u.id=c.checked_by WHERE c.id=?`, [id]);
    if (!check) return res.status(404).json({ error: 'Hole check not found.' });
    const [measurements] = await db.execute(`SELECT h.punch_size AS punchSize,h.profile,h.target_mm AS targetMm,
      m.measured_mm AS measuredMm FROM unit1_hole_check_measurements m
      JOIN unit1_job_card_holes h ON h.id=m.job_card_hole_id WHERE m.check_id=? ORDER BY h.sequence_no`, [id]);
    res.json({ data: { ...check, measurements } });
  } catch (error) { next(error); }
});

router.get('/runs/:id', access([], 'unit1.production.view'), async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid production run ID.' });
  try {
    const run = await getRun(id);
    if (!run) return res.status(404).json({ error: 'Production run not found.' });
    requireMachine(req, run.machineId);
    const [events] = await db.execute('SELECT id, event_type AS eventType, pieces_delta AS piecesDelta, note, actor_user_id AS actorUserId, created_at AS createdAt FROM unit1_production_events WHERE run_id = ? ORDER BY id DESC', [id]);
    const [holeChecks] = await db.execute('SELECT h.profile, h.target_mm AS targetMm, hc.measured_mm AS measuredMm, hc.checked_at AS checkedAt FROM unit1_run_hole_checks hc JOIN unit1_job_card_holes h ON h.id=hc.job_card_hole_id WHERE hc.run_id=? ORDER BY h.sequence_no', [id]);
    const [bundles] = await db.execute('SELECT id,bundle_no AS bundleNo,pieces,theoretical_used_kg AS theoreticalUsedKg,hole_scrap_kg AS holeScrapKg,density_g_cm3 AS densityGcm3,member_name AS memberName,entered_by AS enteredBy,created_at AS createdAt FROM unit1_production_bundles WHERE run_id=? ORDER BY bundle_no', [id]);
    res.json({ data: { ...run, events, holeChecks, bundles } });
  } catch (error) { next(error); }
});

router.post('/runs', access([], 'unit1.production.coil.assign'), async (req, res, next) => {
  const jobCardId = positiveId(req.body?.jobCardId);
  const coilId = positiveId(req.body?.coilId);
  const coilNumber = positiveId(req.body?.coilNumber);
  if (!jobCardId || !coilId || !coilNumber) return res.status(400).json({ error: 'Select a job card and scan a numbered coil.' });
  try {
    const id = await inTransaction(async connection => {
      const [[job]] = await connection.execute('SELECT * FROM unit1_job_cards WHERE id=? FOR UPDATE', [jobCardId]);
      if (!job || job.status !== 'open') throw httpError(409, 'Choose an open job card.');
      const machineId = job.machine_id;
      if (!machineId) throw httpError(409, 'Assign this job card to a machine before scanning a coil.');
      const [[machine]] = await connection.execute('SELECT id, is_active AS isActive FROM unit1_machines WHERE id = ? FOR UPDATE', [machineId]);
      if (!machine || !machine.isActive) throw httpError(409, 'Choose an active machine.');
      const [[coil]] = await connection.execute('SELECT id, coil_qty AS coilQty, status, qr_generated_at AS qrGeneratedAt, material_type AS materialType, width_mm AS widthMm, thickness_mm AS thicknessMm FROM coils WHERE id = ? FOR UPDATE', [coilId]);
      if (!coil || !coil.qrGeneratedAt || !['in_stock', 'allocated'].includes(coil.status)) throw httpError(409, 'Scanned coil is no longer available.');
      if (coilNumber > coil.coilQty) throw httpError(400, 'Coil number exceeds received Coil Qty.');
      if (!coilMatchesJob(coil, { materialType: job.material_type, coilWidthMm: job.coil_width_mm, coilThicknessMm: job.coil_thickness_mm })) throw httpError(409, 'Incorrect coil for current job card. Material, width and thickness must match.');
      const [[progress]] = await connection.execute('SELECT COALESCE(SUM(produced_pieces),0) AS pieces FROM unit1_production_runs WHERE job_card_id=?', [jobCardId]);
      if (Number(progress.pieces) >= Number(job.production_qty)) throw httpError(409, 'Job card production quantity is already complete.');
      const [machineRuns] = await connection.execute("SELECT id FROM unit1_production_runs WHERE machine_id = ? AND status IN ('setup','running','paused') LIMIT 1", [machineId]);
      if (machineRuns.length) throw httpError(409, 'This machine already has an open production run.');
      const [coilRuns] = await connection.execute('SELECT id FROM unit1_production_runs WHERE coil_id = ? AND coil_number = ? LIMIT 1', [coilId, coilNumber]);
      if (coilRuns.length) throw httpError(409, 'This numbered coil has already been assigned to production.');
      const [insert] = await connection.execute(
        "INSERT INTO unit1_production_runs (machine_id, coil_id, coil_number, product_type, job_card_id, status, started_at, created_by) VALUES (?, ?, ?, ?, ?, 'setup', UTC_TIMESTAMP(3), ?)",
        [machineId, coilId, coilNumber, job.structure_type, jobCardId, req.user.id],
      );
      await connection.execute("INSERT INTO unit1_production_events (run_id, event_type, actor_user_id) VALUES (?, 'coil_inserted', ?)", [insert.insertId, req.user.id]);
      return insert.insertId;
    });
    publish(req, id, 'coil_inserted');
    res.status(201).json({ data: await getRun(id) });
  } catch (error) { next(error); }
});

router.post('/runs/:id/hole-check', access([], 'unit1.production.supervise'), async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid run ID.' });
  if (!Array.isArray(req.body?.measurements) || req.body.approved !== true) return res.status(400).json({ error: 'Record every measured hole and confirm supervisor approval.' });
  try {
    await inTransaction(async connection => {
      const [[run]] = await connection.execute('SELECT job_card_id AS jobCardId,status FROM unit1_production_runs WHERE id=? FOR UPDATE', [id]);
      if (!run) throw httpError(404, 'Production run not found.');
      if (!['setup','running','paused'].includes(run.status) || !run.jobCardId) throw httpError(409, 'Hole checks are available during setup or an active production run.');
      const [holes] = await connection.execute('SELECT id,target_mm AS targetMm FROM unit1_job_card_holes WHERE job_card_id=? ORDER BY sequence_no', [run.jobCardId]);
      if (req.body.measurements.length !== holes.length) throw httpError(400, 'Record every hole dimension on the job card.');
      const submitted = new Map();
      for (const item of req.body.measurements) {
        const holeId = positiveId(item?.holeId);
        const measured = Number(item?.measuredMm);
        if (!holeId || item?.measuredMm === null || item?.measuredMm === '' || submitted.has(holeId) || !Number.isFinite(measured) || measured < 0 || measured > 1000000) throw httpError(400, 'Enter a valid measured dimension for each hole.');
        submitted.set(holeId, measured);
      }
      if (holes.some(hole => !submitted.has(hole.id))) throw httpError(400, 'Measured holes do not match the job card.');
      const firstPiece = run.status === 'setup';
      const [check] = await connection.execute('INSERT INTO unit1_hole_checks (run_id,check_type,checked_by) VALUES (?,?,?)', [id,firstPiece ? 'first_piece' : 'recheck',req.user.id]);
      for (const hole of holes) {
        await connection.execute('INSERT INTO unit1_hole_check_measurements (check_id,job_card_hole_id,measured_mm) VALUES (?,?,?)', [check.insertId,hole.id,submitted.get(hole.id)]);
        if (firstPiece) await connection.execute('INSERT INTO unit1_run_hole_checks (run_id,job_card_hole_id,measured_mm,checked_by) VALUES (?,?,?,?)', [id,hole.id,submitted.get(hole.id),req.user.id]);
      }
      if (firstPiece) await connection.execute("UPDATE unit1_production_runs SET status='running',hole_checked_at=UTC_TIMESTAMP(3),hole_checked_by=?,last_resumed_at=UTC_TIMESTAMP(3) WHERE id=?", [req.user.id,id]);
      await connection.execute("INSERT INTO unit1_production_events (run_id,event_type,actor_user_id) VALUES (?,'hole_checked',?)", [id,req.user.id]);
    });
    publish(req,id,'hole_checked');
    res.json({ data: await getRun(id) });
  } catch (error) { next(error); }
});

router.post('/runs/:id/bundles', access([], 'unit1.production.bundle'), async (req, res, next) => {
  const id = positiveId(req.params.id);
  const pieces = positiveId(req.body?.pieces);
  if (!id || !pieces || pieces > 100000) return res.status(400).json({ error: 'Bundle pieces must be a whole number from 1 to 100000.' });
  try {
    await inTransaction(async connection => {
      const [[run]] = await connection.execute('SELECT machine_id AS machineId,status,job_card_id AS jobCardId,coil_id AS coilId,hole_checked_at AS holeCheckedAt FROM unit1_production_runs WHERE id=? FOR UPDATE', [id]);
      if (!run) throw httpError(404, 'Production run not found.');
      requireMachine(req, run.machineId);
      if (run.status !== 'running' || !run.holeCheckedAt || !run.jobCardId) throw httpError(409, 'Supervisor must approve the first-piece hole check before bundle entry.');
      const [[job]] = await connection.execute('SELECT production_qty AS productionQty,member_name AS memberName,cut_length_mm AS cutLengthMm,punch_size AS punchSize FROM unit1_job_cards WHERE id=? FOR UPDATE', [run.jobCardId]);
      const [[coil]] = await connection.execute('SELECT material_type AS materialType,width_mm AS widthMm,thickness_mm AS thicknessMm FROM coils WHERE id=?', [run.coilId]);
      const [[material]] = await connection.execute('SELECT density_g_cm3 AS densityGcm3 FROM unit1_material_densities WHERE material_type=?', [coil.materialType]);
      const densityGcm3 = Number(material?.densityGcm3 ?? 7.85);
      const usedKg = theoreticalWeightKg({ widthMm: coil.widthMm, thicknessMm: coil.thicknessMm, lengthMm: job.cutLengthMm, pieces, densityGcm3 });
      if (usedKg === null) throw httpError(409, 'Coil width, thickness and job card cut length are required to calculate material use.');
      const [holes] = await connection.execute('SELECT COALESCE(punch_size, ?) AS punchSize FROM unit1_job_card_holes WHERE job_card_id=? ORDER BY sequence_no', [job.punchSize, run.jobCardId]);
      const scrapKg = holeScrapKg({ holes, thicknessMm: coil.thicknessMm, pieces, densityGcm3 });
      const [[progress]] = await connection.execute('SELECT COALESCE(SUM(produced_pieces),0) AS produced FROM unit1_production_runs WHERE job_card_id=?', [run.jobCardId]);
      if (Number(progress.produced) + pieces > Number(job.productionQty)) throw httpError(409, `Bundle exceeds the job card balance of ${Number(job.productionQty) - Number(progress.produced)} pieces.`);
      const [[last]] = await connection.execute('SELECT COALESCE(MAX(bundle_no),0) AS bundleNo FROM unit1_production_bundles WHERE run_id=?', [id]);
      const [[holeCheck]] = await connection.execute('SELECT id FROM unit1_hole_checks WHERE run_id=? ORDER BY id DESC LIMIT 1', [id]);
      if (!holeCheck) throw httpError(409, 'Supervisor must record a hole check before bundle entry.');
      const activeShift = currentShift(await getSchedule(connection));
      await connection.execute('INSERT INTO unit1_production_bundles (run_id,bundle_no,pieces,theoretical_used_kg,density_g_cm3,hole_scrap_kg,shift,shift_date,member_name,entered_by,hole_check_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id,Number(last.bundleNo)+1,pieces,Number(usedKg.toFixed(4)),densityGcm3,scrapKg === null ? null : Number(scrapKg.toFixed(4)),activeShift.name,activeShift.shiftDate,job.memberName,req.user.id,holeCheck.id]);
      await connection.execute('UPDATE unit1_production_runs SET produced_pieces=produced_pieces+? WHERE id=?', [pieces,id]);
      if (Number(progress.produced) + pieces === Number(job.productionQty)) await connection.execute("UPDATE unit1_job_cards SET status='completed' WHERE id=?", [run.jobCardId]);
      await connection.execute("INSERT INTO unit1_production_events (run_id,event_type,pieces_delta,actor_user_id) VALUES (?,'bundle_added',?,?)", [id,pieces,req.user.id]);
    });
    publish(req,id,'bundle_added');
    res.json({ data: await getRun(id) });
  } catch (error) { next(error); }
});

router.post('/runs/:id/output', access([], 'unit1.production.operate'), async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid production run ID.' });
  const result = validateOutput(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  try {
    await inTransaction(async connection => {
      const [[run]] = await connection.execute('SELECT status, produced_pieces AS producedPieces, job_card_id AS jobCardId FROM unit1_production_runs WHERE id = ? FOR UPDATE', [id]);
      if (!run) throw httpError(404, 'Production run not found.');
      if (run.jobCardId) throw httpError(409, 'Record job card output as a bundle after first-piece approval.');
      if (run.status !== 'running') throw httpError(409, 'Output can only be recorded while the machine is running.');
      if (Number(run.producedPieces) + result.value.pieces > 4294967295) throw httpError(400, 'Total pieces exceeds the supported range.');
      await connection.execute('UPDATE unit1_production_runs SET produced_pieces = produced_pieces + ? WHERE id = ?', [result.value.pieces, id]);
      await connection.execute("INSERT INTO unit1_production_events (run_id, event_type, pieces_delta, note, actor_user_id) VALUES (?, 'pieces_added', ?, ?, ?)", [id, result.value.pieces, result.value.note, req.user.id]);
    });
    publish(req, id, 'pieces_added');
    res.json({ data: await getRun(id) });
  } catch (error) { next(error); }
});

router.post('/runs/:id/remove-coil', access([], 'unit1.production.coil.remove'), async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid production run ID.' });
  try {
    await inTransaction(async connection => {
      const [[run]] = await connection.execute('SELECT status,job_card_id AS jobCardId FROM unit1_production_runs WHERE id=? FOR UPDATE', [id]);
      if (!run) throw httpError(404, 'Production run not found.');
      if (run.status !== 'setup' || !run.jobCardId) throw httpError(409, 'Only an unapproved setup coil can be unassigned.');
      await connection.execute('DELETE FROM unit1_production_events WHERE run_id=?', [id]);
      await connection.execute('DELETE FROM unit1_production_runs WHERE id=?', [id]);
    });
    publish(req, id, 'coil_removed');
    res.json({ data: { removed: true } });
  } catch (error) { next(error); }
});

router.post('/runs/:id/:action', access([], 'unit1.production.supervise'), async (req, res, next) => {
  const id = positiveId(req.params.id);
  const action = req.params.action;
  if (!id) return res.status(400).json({ error: 'Invalid production run ID.' });
  if (!['pause', 'resume', 'complete'].includes(action)) return res.status(404).json({ error: 'Unknown production action.' });
  try {
    await inTransaction(async connection => {
      const [[run]] = await connection.execute('SELECT status, coil_id AS coilId FROM unit1_production_runs WHERE id = ? FOR UPDATE', [id]);
      if (!run) throw httpError(404, 'Production run not found.');
      if (action === 'pause') {
        if (run.status !== 'running') throw httpError(409, 'Only a running machine can be paused.');
        await connection.execute("UPDATE unit1_production_runs SET run_seconds = run_seconds + GREATEST(TIMESTAMPDIFF(SECOND, last_resumed_at, UTC_TIMESTAMP(3)), 0), last_resumed_at = NULL, status = 'paused' WHERE id = ?", [id]);
      } else if (action === 'resume') {
        if (run.status !== 'paused') throw httpError(409, 'Only a paused machine can be resumed.');
        const [[machine]] = await connection.execute('SELECT m.is_active AS isActive FROM unit1_machines m JOIN unit1_production_runs r ON r.machine_id = m.id WHERE r.id = ?', [id]);
        if (!machine.isActive) throw httpError(409, 'Activate the machine before resuming production.');
        await connection.execute("UPDATE unit1_production_runs SET last_resumed_at = UTC_TIMESTAMP(3), status = 'running' WHERE id = ?", [id]);
      } else {
        if (!['running', 'paused'].includes(run.status)) throw httpError(409, 'Complete the first-piece check or remove the setup coil first.');
        await connection.execute("UPDATE unit1_production_runs SET run_seconds = run_seconds + CASE WHEN status = 'running' THEN GREATEST(TIMESTAMPDIFF(SECOND, last_resumed_at, UTC_TIMESTAMP(3)), 0) ELSE 0 END, last_resumed_at = NULL, status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [id]);
        const [[coil]] = await connection.execute('SELECT coil_qty AS coilQty FROM coils WHERE id = ? FOR UPDATE', [run.coilId]);
        const [[count]] = await connection.execute("SELECT COUNT(*) AS completedQty FROM unit1_production_runs WHERE coil_id = ? AND status = 'completed'", [run.coilId]);
        if (Number(count.completedQty) >= Number(coil.coilQty)) await connection.execute("UPDATE coils SET status = 'consumed' WHERE id = ?", [run.coilId]);
      }
      await connection.execute('INSERT INTO unit1_production_events (run_id, event_type, actor_user_id) VALUES (?, ?, ?)', [id, action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'completed', req.user.id]);
    });
    publish(req, id, action);
    res.json({ data: await getRun(id) });
  } catch (error) { next(error); }
});

router.use((error, _req, res, next) => {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Machine or numbered coil is already assigned to production.' });
  if (['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) return res.status(503).json({ error: 'Unit 1 production database unavailable or schema needs migration.' });
  next(error);
});

module.exports = router;
