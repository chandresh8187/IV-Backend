const { coilBalance } = require('./unit1CoilBalance');

const conflict = message => Object.assign(new Error(message), { status: 409 });

// The caller owns the transaction. Locking the run serializes returns with bundles.
async function returnCoil(connection, id, actorId) {
  const [[run]] = await connection.execute('SELECT status,coil_id AS coilId,coil_number AS coilNumber,job_card_id AS jobCardId FROM unit1_production_runs WHERE id=? FOR UPDATE', [id]);
  if (!run) throw Object.assign(new Error('Production run not found.'), { status: 404 });
  if (!run.jobCardId || !['running', 'paused'].includes(run.status)) throw conflict('Only a running or paused coil can be returned. Remove an unapproved setup coil instead.');
  await connection.execute('SELECT id FROM coils WHERE id=? FOR UPDATE', [run.coilId]);
  const balance = await coilBalance(connection, run.coilId, run.coilNumber);
  if (balance.remainingKg <= 0) throw conflict('This coil has no remaining material. Complete the coil run instead.');
  await connection.execute(`UPDATE unit1_production_runs SET
    run_seconds=run_seconds+CASE WHEN status='running' THEN GREATEST(TIMESTAMPDIFF(SECOND,last_resumed_at,UTC_TIMESTAMP(3)),0) ELSE 0 END,
    last_resumed_at=NULL,status='returned',completed_at=UTC_TIMESTAMP(3) WHERE id=?`, [id]);
  await connection.execute("INSERT INTO unit1_production_events (run_id,event_type,note,actor_user_id) VALUES (?,'coil_returned',?,?)", [id, `Returned to stock; calculated remaining ${balance.remainingKg.toFixed(3)} kg`, actorId]);
  return balance;
}

module.exports = { returnCoil };
