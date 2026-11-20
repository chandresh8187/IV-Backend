const { productionWeightKg, holeScrapKg } = require('./unit1MaterialWeight');
const { jobThicknessForCoil } = require('./unit1AllowedCoilSizes');
const { captureProduction } = require('./unit1MaterialStock');
const fail = message => Object.assign(new Error(message), { status: 409 });
const sizeKey = value => String(value || '').toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '');
const sameHole = (a, b) => (!(a.punchName && b.punchName) || a.punchName === b.punchName) && a.targetMm != null && b.targetMm != null && sizeKey(a.punchSize) === sizeKey(b.punchSize) && a.profile === b.profile && Number(a.targetMm) === Number(b.targetMm) && (a.centerOffsetMm == null ? null : Number(a.centerOffsetMm)) === (b.centerOffsetMm == null ? null : Number(b.centerOffsetMm));

function correctedInspection(snapshot, job, oldHoles, newHoles) {
  const used = new Set();
  const measurements = (snapshot.measurements || []).map(reading => {
    const old = oldHoles.find(hole => Number(hole.id) === Number(reading.currentDefinitionHoleId || reading.holeId))
      || oldHoles.filter(hole => sameHole(hole, reading)).filter((_, i, list) => list.length === 1)[0];
    let current = old && newHoles.find(hole => !used.has(hole.id) && sameHole(hole, old));
    if (old && !current) {
      const before = oldHoles.filter(hole => hole.profile === old.profile);
      const after = newHoles.filter(hole => hole.profile === old.profile);
      if (before.length === after.length) current = after[before.indexOf(old)];
      if (current && used.has(current.id)) current = null;
    }
    if (current) used.add(current.id);
    return {
      ...reading,
      originalTargetMm: reading.originalTargetMm ?? reading.targetMm,
      originalCenterOffsetMm: Object.hasOwn(reading, 'originalCenterOffsetMm')
        ? reading.originalCenterOffsetMm
        : old?.centerOffsetMm ?? null,
      originalPunchSize: reading.originalPunchSize ?? reading.punchSize,
      currentDefinitionHoleId: current?.id || null,
      targetMm: current ? Number(current.targetMm) : null,
      punchSize: current?.punchSize || reading.punchSize,
      profile: current?.profile || reading.profile,
      originalProfile: reading.originalProfile ?? reading.profile,
      originalPunchName: reading.originalPunchName ?? reading.punchName ?? reading.punchLetter,
      punchName: current ? current.punchName : reading.punchName,
      punchLetter: current ? (require("./unit1PunchNames").punchNameFor(current,newHoles,job.punchSize)||"Legacy") : reading.punchLetter,
      revisionStatus: current ? 'corrected' : 'unmatched',
    };
  });
  const unmatched = measurements.filter(reading => reading.revisionStatus === 'unmatched').length;
  const missing = Math.max(0, newHoles.length - used.size);
  return {
    ...snapshot,
    originalSectionSize: snapshot.originalSectionSize ?? snapshot.sectionSize,
    originalSectionProfile: snapshot.originalSectionProfile ?? snapshot.sectionProfile ?? snapshot.profileType,
    originalCutLengthMm: snapshot.originalCutLengthMm ?? snapshot.cutLengthMm,
    jobCardId: job.id, memberName: job.memberName, sectionSize: job.sectionSize,
    cutLengthMm: job.cutLengthMm, profileType: job.structureType,
    ...(job.sectionProfile ? { sectionProfile: job.sectionProfile } : {}),
    customerName: job.customerName, projectName: job.projectNameCapacity,
    measurements,
    correctionNote: `Job card corrected. Entered measurements are unchanged.${unmatched ? ` ${unmatched} recorded readings have no unambiguous revised target.` : ''}${missing ? ` ${missing} revised holes have no recorded reading.` : ''}`,
  };
}

async function correctJobDependencies(connection, before, value, oldHoles, actorId) {
  const [bundles] = await connection.execute(`SELECT b.id,b.run_id AS runId,b.pieces,b.theoretical_used_kg AS usedKg,b.hole_scrap_kg AS scrapKg,
    b.cut_blade_size_mm AS cutBladeSizeMm,b.cut_blade_scrap_kg AS cutBladeScrapKg,
    b.member_name AS memberName,b.job_snapshot AS jobSnapshot,r.coil_id AS coilId,r.coil_number AS coilNumber,
    c.width_mm AS widthMm,c.thickness_mm AS thicknessMm,c.material_type AS materialType,
    COALESCE(b.density_g_cm3,d.density_g_cm3,7.85) AS densityGcm3
    FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id JOIN coils c ON c.id=r.coil_id
    LEFT JOIN unit1_material_densities d ON d.material_type=c.material_type WHERE r.job_card_id=? ORDER BY b.id FOR UPDATE`, [before.id]);
  const [checks] = await connection.execute(`SELECT hc.id,hc.report_snapshot AS reportSnapshot,r.coil_id coilId,r.coil_number coilNumber,c.material_type materialType,c.width_mm widthMm,c.thickness_mm thicknessMm,COALESCE(d.density_g_cm3,7.85) densityGcm3 FROM unit1_hole_checks hc
    JOIN unit1_production_runs r ON r.id=hc.run_id JOIN coils c ON c.id=r.coil_id LEFT JOIN unit1_material_densities d ON d.material_type=c.material_type WHERE r.job_card_id=? ORDER BY hc.id FOR UPDATE`, [before.id]);
  const [movements] = await connection.execute('SELECT id,item_id AS itemId,quantity FROM unit1_material_stock_movements WHERE source_job_card_id=? AND movement_type=\'production\' FOR UPDATE', [before.id]);
  const [currentHoles] = await connection.execute('SELECT id,punch_size AS punchSize,punch_name AS punchName,profile,target_mm AS targetMm, center_offset_mm AS centerOffsetMm FROM unit1_job_card_holes WHERE job_card_id=? AND is_active=1 ORDER BY sequence_no', [before.id]);
  const after = { ...value, id: before.id };
  const [revision] = await connection.execute('INSERT INTO unit1_job_card_revisions (job_card_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)', [before.id,actorId,JSON.stringify({ job: before, holes: oldHoles, bundles, checks, movements }),JSON.stringify(after)]);
  for (const bundle of bundles) {
    const { blankKg, usedKg, bladeKg } = productionWeightKg({ widthMm: bundle.widthMm, thicknessMm: bundle.thicknessMm,
      lengthMm: value.cutLengthMm, pieces: bundle.pieces, densityGcm3: bundle.densityGcm3,
      cutBladeSizeMm: bundle.cutBladeSizeMm, cutBladeThicknessMm: jobThicknessForCoil(bundle, value) });
    const scrapKg = holeScrapKg({ holes: value.holes, thicknessMm: bundle.thicknessMm, pieces: bundle.pieces, densityGcm3: bundle.densityGcm3 });
    if (usedKg == null || (scrapKg != null && scrapKg > blankKg)) throw fail('Corrected dimensions do not produce a valid coil-use and scrap balance.');
    const snapshot = { ...after, materialType: bundle.materialType, coilWidthMm: bundle.widthMm, coilThicknessMm: bundle.thicknessMm, correctionRevisionId: revision.insertId };
    await connection.execute('UPDATE unit1_production_bundles SET member_name=?,theoretical_used_kg=?,hole_scrap_kg=?,cut_blade_scrap_kg=?,density_g_cm3=?,job_snapshot=? WHERE id=?', [value.memberName,Number(usedKg.toFixed(4)),scrapKg == null ? null : Number(scrapKg.toFixed(4)),bladeKg == null ? null : Number(bladeKg.toFixed(4)),bundle.densityGcm3,JSON.stringify(snapshot),bundle.id]);
  }
  for (const check of checks) {
    if (!check.reportSnapshot) continue;
    const snapshot = correctedInspection(JSON.parse(check.reportSnapshot), after, oldHoles, currentHoles);
    if(snapshot.rejectedPieces>0)Object.assign(snapshot,require('./unit1RejectedMaterial').rejectionWeight({
      ...check, cutLengthMm:value.cutLengthMm, cutBladeSizeMm:snapshot.rejectionWeightInputs?.cutBladeSizeMm,
      cutBladeThicknessMm:jobThicknessForCoil(check,value),
      densityGcm3:check.materialType===snapshot.materialType?(snapshot.rejectionWeightInputs?.densityGcm3??check.densityGcm3):check.densityGcm3,
    },currentHoles,snapshot.rejectedPieces,snapshot.rejectedLines));
    snapshot.correctionRevisionId = revision.insertId;
    await connection.execute('UPDATE unit1_hole_checks SET report_snapshot=? WHERE id=?', [JSON.stringify(snapshot),check.id]);
  }
  const coils = [...new Map([...bundles,...checks.filter(check=>JSON.parse(check.reportSnapshot||'{}').rejectedPieces>0)].map(bundle => [`${bundle.coilId}:${bundle.coilNumber}`, bundle])).values()].sort((a, b) => a.coilId - b.coilId || a.coilNumber - b.coilNumber);
  for (const coil of coils) {
    const balance=await require('./unit1CoilBalance').coilBalance(connection,coil.coilId,coil.coilNumber);
    if(balance.remainingKg!=null&&balance.remainingKg<-.00005)throw fail('This correction exceeds the available stock for this coil size. Check cut length and recorded quantities.');
  }
  if(movements.length)await captureProduction(connection, null, before.id, true, true);
  const itemIds = [...new Set(movements.map(row => row.itemId))];
  if (itemIds.length) {
    const [negative] = await connection.execute(`SELECT item_id FROM unit1_material_stock_movements WHERE item_id IN (${itemIds.map(() => '?').join(',')}) GROUP BY item_id HAVING SUM(quantity)<0`, itemIds);
    if (negative.length) throw fail('Affected stock has already been consumed or transferred. Correct the downstream movement before revising its source material.');
  }
}

module.exports = { correctedInspection, correctJobDependencies };
