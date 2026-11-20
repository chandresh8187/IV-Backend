const { freezeJobHistory, jobSpecificationChanged } = require('./unit1JobHistory');
const { coilMatchesJob } = require('./unit1CoilMatch');
const { correctJobDependencies } = require('./unit1JobCorrection');
const fail = message => Object.assign(new Error(message), { status: 409 });

async function editJobCard(connection, id, value, actorId, { previousSectionProfile } = {}) {
  const [[job]] = await connection.execute(`SELECT id,job_date AS jobDate,customer_name AS customerName,project_name_capacity AS projectNameCapacity,
    production_qty AS productionQty,structure_type AS structureType,member_name AS memberName,section_size AS sectionSize,shift,
    cut_length_mm AS cutLengthMm,planned_machine_id AS plannedMachineId,machine_id AS machineId,material_type AS materialType,
    coil_width_mm AS coilWidthMm,coil_thickness_mm AS coilThicknessMm,allowed_coil_sizes AS allowedCoilSizes,punch_size AS punchSize,status,archived_at AS archivedAt
    FROM unit1_job_cards WHERE id=? FOR UPDATE`, [id]);
  if (!job) throw Object.assign(new Error('Job card not found.'), { status: 404 });
  if (previousSectionProfile) job.sectionProfile = previousSectionProfile;
  if (job.archivedAt || !['open', 'completed'].includes(job.status)) throw fail('Only active job cards can be edited.');

  const [runs] = await connection.execute('SELECT id,status,machine_id AS machineId,coil_id AS coilId,produced_pieces AS producedPieces FROM unit1_production_runs WHERE job_card_id=?', [id]);
  const produced = runs.reduce((sum, run) => sum + Number(run.producedPieces || 0), 0);
  if (value.productionQty < produced) throw fail('Production quantity cannot be less than pieces already produced.');
  const [holes] = await connection.execute('SELECT id,punch_size AS punchSize,punch_name AS punchName,profile,target_mm AS targetMm, center_offset_mm AS centerOffsetMm FROM unit1_job_card_holes WHERE job_card_id=? AND is_active=1 ORDER BY sequence_no', [id]);
  const sectionProfileChanged = Boolean(previousSectionProfile && value.sectionProfile && previousSectionProfile !== value.sectionProfile);
  const changed = sectionProfileChanged || jobSpecificationChanged(job, value, holes);
  const active = runs.filter(run => ['setup', 'running', 'paused'].includes(run.status));
  for (const run of active) {
    if (Number(run.machineId) !== Number(value.plannedMachineId || job.machineId)) throw fail('Return the active coil before changing the planned machine.');
    const [[coil]] = await connection.execute('SELECT material_type AS materialType,width_mm AS widthMm,thickness_mm AS thicknessMm FROM coils WHERE id=?', [run.coilId]);
    if (!coilMatchesJob(coil, value,{allowSizeVariation:true})) throw fail('Return the active coil before changing the job material.');
  }
  if (runs.length) {
    await freezeJobHistory(connection, { ...job, holes });
  }
  await connection.execute(`UPDATE unit1_job_cards SET job_date=?,customer_name=?,project_name_capacity=?,production_qty=?,structure_type=?,member_name=?,section_size=?,shift=?,cut_length_mm=?,planned_machine_id=?,material_type=?,coil_width_mm=?,coil_thickness_mm=?,punch_size=?,status=?,machine_id=? WHERE id=?`,
    [value.jobDate,value.customerName,value.projectNameCapacity,value.productionQty,value.structureType,value.memberName,value.sectionSize,value.shift,value.cutLengthMm,value.plannedMachineId,value.materialType,value.coilWidthMm,value.coilThicknessMm,value.punchSize,value.productionQty === produced ? 'completed' : 'open',!value.plannedMachineId || Number(job.machineId) === Number(value.plannedMachineId) ? job.machineId : null,id]);
  await connection.execute('UPDATE unit1_job_cards SET allowed_coil_sizes=? WHERE id=?',[JSON.stringify(require('./unit1AllowedCoilSizes').allowedCoilSizes(value)),id]);
  if (changed) {
    // Keep referenced hole rows for old inspections, but only the new rows are
    // offered by the current job card. Move old sequence numbers out of the way.
    const [[last]] = await connection.execute('SELECT COALESCE(MAX(sequence_no),0) AS sequenceNo FROM unit1_job_card_holes WHERE job_card_id=?', [id]);
    await connection.execute('UPDATE unit1_job_card_holes SET sequence_no=sequence_no+?,is_active=0 WHERE job_card_id=? AND is_active=1', [Number(last.sequenceNo) + 100, id]);
    for (const hole of value.holes) await connection.execute('INSERT INTO unit1_job_card_holes (job_card_id,sequence_no,profile,punch_size,punch_name,target_mm,center_offset_mm) VALUES (?,?,?,?,?,?,?)', [id,hole.sequenceNo,hole.profile,hole.punchSize,hole.punchName||null,hole.targetMm,hole.centerOffsetMm ?? null]);
    for (const run of active) {
      await connection.execute(`UPDATE unit1_production_runs SET run_seconds=run_seconds+CASE WHEN status='running' AND last_resumed_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND,last_resumed_at,UTC_TIMESTAMP(3)) ELSE 0 END,
        status='setup',product_type=?,last_resumed_at=NULL,hole_checked_at=NULL,hole_checked_by=NULL WHERE id=?`, [value.structureType,run.id]);
      await connection.execute("INSERT INTO unit1_production_events (run_id,event_type,note,actor_user_id) VALUES (?,'paused',?,?)", [run.id,'Job card specifications edited; first-piece inspection required.',actorId]);
    }
  }
  if (runs.length) await correctJobDependencies(connection, job, value, holes, actorId);
}

module.exports = { editJobCard };

