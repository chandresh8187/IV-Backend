const { freezeJobHistory } = require('./unit1JobHistory');
const { correctJobDependencies } = require('./unit1JobCorrection');
const { ensurePhysicalCoils, physicalCoilCodeSql } = require('./unit1PhysicalCoils');
const { matchesAllowedCoilSize } = require('./unit1AllowedCoilSizes');
const fail = message => Object.assign(new Error(message), { status: 409 });

async function editCoil(connection, id, value, actorId, rateProvided = true, options = {}) {
  const [runs] = await connection.execute('SELECT id,job_card_id AS jobCardId,coil_number AS coilNumber,status FROM unit1_production_runs WHERE coil_id=? ORDER BY id FOR UPDATE', [id]);
  const [planned]=await connection.execute('SELECT job_card_id AS jobCardId,coil_number AS coilNumber FROM unit1_job_card_coils WHERE coil_id=? FOR UPDATE',[id]);
  const jobIds = [...new Set([...runs,...planned].map(run => run.jobCardId).filter(Boolean))].sort((a,b) => a-b);
  const jobs = [];
  for (const jobId of jobIds) {
    await connection.execute('SELECT id FROM unit1_production_runs WHERE job_card_id=? ORDER BY id FOR UPDATE', [jobId]);
    const [[job]] = await connection.execute(`SELECT id,job_date AS jobDate,customer_name AS customerName,project_name_capacity AS projectNameCapacity,
      production_qty AS productionQty,structure_type AS structureType,member_name AS memberName,section_size AS sectionSize,shift,
      cut_length_mm AS cutLengthMm,planned_machine_id AS plannedMachineId,machine_id AS machineId,material_type AS materialType,
      coil_width_mm AS coilWidthMm,coil_thickness_mm AS coilThicknessMm,allowed_coil_sizes AS allowedCoilSizes,punch_size AS punchSize,status
      FROM unit1_job_cards WHERE id=? FOR UPDATE`, [jobId]);
    const [holes] = await connection.execute('SELECT id,sequence_no AS sequenceNo,punch_size AS punchSize,punch_name AS punchName,profile,target_mm AS targetMm,center_offset_mm AS centerOffsetMm FROM unit1_job_card_holes WHERE job_card_id=? AND is_active=1 ORDER BY sequence_no', [jobId]);
    jobs.push({ ...job, holes });
    await freezeJobHistory(connection, job);
  }
  const [[existing]] = await connection.execute('SELECT * FROM coils WHERE id=? FOR UPDATE', [id]);
  if (!existing) throw Object.assign(new Error('Coil inward not found.'), { status: 404 });
  if (!rateProvided) value.ratePerKg = existing.rate_per_kg == null ? null : Number(existing.rate_per_kg);
  if(existing.invoice_group_id && (Number(value.actualNetKg)!==Number(existing.actual_net_kg)||value.invoice!==existing.invoice||value.vendorCode!==existing.vendor_code||String(value.tcNumber||'')!==String(existing.tc_number||'')))throw fail('This inward belongs to a shared-weight invoice. Record weights through its invoice details to keep the total consistent.');
  if (runs.some(run => Number(run.coilNumber) > Number(value.coilQty))) throw fail('Coil quantity cannot remove a physical coil number that already has production history.');
  if(planned.some(item=>Number(item.coilNumber)>Number(value.coilQty)))throw fail('A removed coil number is selected on a job card. Edit that job card selection before reducing this inward quantity.');
  if(Number(value.coilQty)<Number(existing.coil_qty)){
    const [balances]=await connection.execute('SELECT coil_number FROM unit1_coil_stock_balances WHERE coil_id=? AND coil_number>? LIMIT 1',[id,value.coilQty]);
    if(balances.length)throw fail('A removed coil number has an audited stock adjustment. Keep its quantity and adjust current stock instead.');
  }
  const specificationChanged = existing.material_type !== value.materialType || existing.grade !== value.grade || Number(existing.width_mm) !== Number(value.widthMm) || Number(existing.thickness_mm) !== Number(value.thicknessMm);
  if (specificationChanged) for (const job of jobs) {
    if (job.allowedCoilSizes) {
      if (!matchesAllowedCoilSize(value, job)) throw fail('Corrected coil size must match an allowed job card size. Update the material template first.');
      continue;
    }
    const [others] = await connection.execute(`SELECT c.id,c.material_type,c.width_mm,c.thickness_mm FROM unit1_production_runs r JOIN coils c ON c.id=r.coil_id
      WHERE r.job_card_id=? AND r.coil_id<>? AND r.status IN ('setup','running','paused')`, [job.id,id]);
    const [otherPlanned]=await connection.execute('SELECT c.id,c.material_type,c.width_mm,c.thickness_mm FROM unit1_job_card_coils jc JOIN coils c ON c.id=jc.coil_id WHERE jc.job_card_id=? AND jc.coil_id<>?',[job.id,id]);
    if ([...others,...otherPlanned].some(coil => {
      const updated = options.updates?.get(Number(coil.id));
      return (updated?.materialType ?? coil.material_type) !== value.materialType;
    })) throw fail('A linked job has another active or selected coil with a different material. Correct the material selections together, or revise the job selection before this correction.');
  }
  const [beforeBundles] = await connection.execute('SELECT b.* FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id WHERE r.coil_id=? ORDER BY b.id', [id]);
  const after = { ...existing, invoice:value.invoice,invoice_date:value.invoiceDate,tc_number:value.tcNumber,
    vendor_code:value.vendorCode,supplier:value.supplier,grade:value.grade,material_type:value.materialType,
    coil_qty:value.coilQty,thickness_mm:value.thicknessMm,width_mm:value.widthMm,estimated_kg:value.estimatedKg,
    gross_kg:value.grossKg,tare_kg:value.tareKg,actual_net_kg:value.actualNetKg,rate_per_kg:value.ratePerKg };
  await connection.execute('INSERT INTO unit1_coil_revisions (coil_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)', [id,actorId,JSON.stringify({ coil: existing, bundles: beforeBundles }),JSON.stringify({ coil:after })]);
  await connection.execute(`UPDATE coils SET invoice=?,invoice_date=?,tc_number=?,vendor_code=?,supplier=?,grade=?,material_type=?,coil_qty=?,thickness_mm=?,width_mm=?,estimated_kg=?,gross_kg=?,tare_kg=?,actual_net_kg=?,rate_per_kg=? WHERE id=?`,
    [value.invoice,value.invoiceDate,value.tcNumber,value.vendorCode,value.supplier,value.grade,value.materialType,value.coilQty,value.thicknessMm,value.widthMm,value.estimatedKg,value.grossKg,value.tareKg,value.actualNetKg,value.ratePerKg,id]);
  if (existing.material_type !== value.materialType) {
    await connection.execute(`UPDATE unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id
      SET b.density_g_cm3=COALESCE((SELECT density_g_cm3 FROM unit1_material_densities WHERE material_type=?),7.85) WHERE r.coil_id=?`, [value.materialType,id]);
  }
  await ensurePhysicalCoils(connection,id,value.coilQty);
  const correction = {id,value,existing,runs,jobs,specificationChanged};
  if (options.deferred) { options.deferred.push(correction); return; }
  await correctEditedCoil(connection,correction,actorId);
}

async function correctEditedCoil(connection, {id,value,existing,runs,jobs,specificationChanged}, actorId) {
  await require('./unit1Weighbridge').refreshCoilSettlements(connection,id,actorId);
  for (const job of jobs) {
    const updateReference=!job.allowedCoilSizes&&specificationChanged&&(!existing||(job.materialType===existing.material_type&&Number(job.coilWidthMm)===Number(existing.width_mm)&&Number(job.coilThicknessMm)===Number(existing.thickness_mm)));
    const updated = updateReference ? { ...job, materialType:value.materialType,coilWidthMm:value.widthMm,coilThicknessMm:value.thicknessMm } : job;
    if (updateReference) await connection.execute('UPDATE unit1_job_cards SET material_type=?,coil_width_mm=?,coil_thickness_mm=? WHERE id=?', [value.materialType,value.widthMm,value.thicknessMm,job.id]);
    await correctJobDependencies(connection, job, updated, job.holes, actorId);
  }
  await connection.execute(`UPDATE unit1_hole_checks hc JOIN unit1_production_runs r ON r.id=hc.run_id
    JOIN coils c ON c.id=r.coil_id
    SET hc.report_snapshot=JSON_SET(hc.report_snapshot,'$.materialType',?,'$.grade',?,'$.coilSize',?,'$.coilInternalId',${physicalCoilCodeSql()})
    WHERE r.coil_id=? AND hc.report_snapshot IS NOT NULL`, [value.materialType,value.grade,`${value.widthMm} x ${value.thicknessMm} mm`,id]);
  if (specificationChanged) for (const run of runs.filter(run => run.jobCardId && ['setup','running','paused'].includes(run.status))) {
    await connection.execute(`UPDATE unit1_production_runs SET run_seconds=run_seconds+CASE WHEN status='running' AND last_resumed_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND,last_resumed_at,UTC_TIMESTAMP(3)) ELSE 0 END,
      status='setup',last_resumed_at=NULL,hole_checked_at=NULL,hole_checked_by=NULL WHERE id=?`, [run.id]);
    await connection.execute("INSERT INTO unit1_production_events (run_id,event_type,note,actor_user_id) VALUES (?,'paused','Coil inward corrected; first-piece inspection required.',?)", [run.id,actorId]);
  }
}

module.exports = { editCoil, correctEditedCoil };
