const {requireSelectedCoil}=require('./unit1JobCoils');
const {coilMatchesJob}=require('./unit1CoilMatch');
const {coilBalance}=require('./unit1CoilBalance');
const httpError=(status,message)=>Object.assign(new Error(message),{status});

// Caller owns the transaction; job creation and setup must commit together.
async function startJobRun(connection,{jobCardId,coilId,coilNumber,stockQrId,selectedRatePerKg,machineId:requestedMachineId,canAssignJob=false},actorId){
      const [[job]] = await connection.execute('SELECT * FROM unit1_job_cards WHERE id=? FOR UPDATE', [jobCardId]);
      if (!job || job.archived_at || job.status !== 'open') throw httpError(409, 'Choose an open job card.');
      if(stockQrId){const selected=await require('./unit1StockQr').selectInward(connection,stockQrId,jobCardId,coilId,true);if(selectedRatePerKg!=null&&Number(selected.ratePerKg)!==Number(selectedRatePerKg))throw httpError(409,'The inward rate changed. Verify the QR and select its current rate again.');if(Number(selected.coilNumber)!==Number(coilNumber))throw httpError(409,'Stock assignments changed. Verify this QR and inward again.');}
      await requireSelectedCoil(connection,jobCardId,coilId,coilNumber);
      const machineId = requestedMachineId || job.machine_id;
      if(job.planned_machine_id && Number(job.planned_machine_id)!==Number(machineId))throw httpError(409,'Select the machine chosen in this production planning.');
      if (requestedMachineId && !job.machine_id && !canAssignJob && Number(job.planned_machine_id)!==Number(machineId)) throw httpError(403,'Only a manager can assign a job card to a machine.');
      if (job.machine_id && Number(job.machine_id)!==Number(machineId)) throw httpError(409,'This job card is already assigned to another machine.');
      if (!machineId) throw httpError(409, 'Assign this job card to a machine before scanning a coil.');
      const [[machine]] = await connection.execute('SELECT id, is_active AS isActive FROM unit1_machines WHERE id = ? FOR UPDATE', [machineId]);
      if (!machine || !machine.isActive) throw httpError(409, 'Choose an active machine.');
      const [otherJobs]=await connection.execute("SELECT id FROM unit1_job_cards WHERE machine_id=? AND status='open' AND archived_at IS NULL AND id<>? FOR UPDATE",[machineId,jobCardId]);
      if(otherJobs.length)throw httpError(409,'This machine already has another assigned job card.');
      const [[coil]] = await connection.execute('SELECT id, coil_qty AS coilQty, status, qr_generated_at AS qrGeneratedAt, material_type AS materialType, width_mm AS widthMm, thickness_mm AS thicknessMm FROM coils WHERE id = ? FOR UPDATE', [coilId]);
      if (!coil || !['in_stock', 'allocated'].includes(coil.status)) throw httpError(409, 'Scanned coil is no longer available.');
      if(!stockQrId&&!coil.qrGeneratedAt)throw httpError(409,'Generate this coil QR before assigning it.');
      if (coilNumber > coil.coilQty) throw httpError(400, 'Coil number exceeds received Coil Qty.');
      if (!coilMatchesJob(coil, { materialType: job.material_type, coilWidthMm: job.coil_width_mm, coilThicknessMm: job.coil_thickness_mm, allowedCoilSizes: job.allowed_coil_sizes },{allowSizeVariation:true})) throw httpError(409, 'Coil width and thickness do not match an allowed job card size.');
      const [[progress]] = await connection.execute('SELECT COALESCE(SUM(produced_pieces),0) AS pieces FROM unit1_production_runs WHERE job_card_id=?', [jobCardId]);
      if (Number(progress.pieces) >= Number(job.production_qty)) throw httpError(409, 'Job card production quantity is already complete.');
      const [machineRuns] = await connection.execute("SELECT id FROM unit1_production_runs WHERE machine_id = ? AND status IN ('setup','running','paused') LIMIT 1", [machineId]);
      if (machineRuns.length) throw httpError(409, 'This machine already has an open production run.');
      const [coilRuns] = await connection.execute(`SELECT id FROM unit1_production_runs WHERE coil_id = ? AND coil_number = ? AND status <> 'returned' LIMIT 1`, [coilId, coilNumber]);
      if (coilRuns.length) throw httpError(409, 'This numbered coil is active or already completed.');
      const balance = await coilBalance(connection, coilId, coilNumber);
      if (balance.weightFinished || (balance.remainingKg != null && balance.remainingKg <= 0)) throw httpError(409, 'This numbered coil has no remaining material.');
      if(!job.machine_id)await connection.execute('UPDATE unit1_job_cards SET machine_id=? WHERE id=?',[machineId,jobCardId]);
      const [insert] = await connection.execute(
        "INSERT INTO unit1_production_runs (machine_id, coil_id, coil_number, product_type, job_card_id, status, started_at, created_by) VALUES (?, ?, ?, ?, ?, 'setup', UTC_TIMESTAMP(3), ?)",
        [machineId, coilId, coilNumber, job.structure_type, jobCardId, actorId],
      );
      if(stockQrId)await connection.execute('UPDATE unit1_production_runs SET stock_qr_id=? WHERE id=?',[stockQrId,insert.insertId]);
      await connection.execute("INSERT INTO unit1_production_events (run_id, event_type, actor_user_id) VALUES (?, 'coil_inserted', ?)", [insert.insertId, actorId]);
      return insert.insertId;
}
module.exports={startJobRun};

