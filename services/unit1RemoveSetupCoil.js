// Caller owns the transaction. A corrected run can be in setup with real history.
async function removeSetupCoil(connection,id,actorId){
 const [[run]]=await connection.execute('SELECT status,job_card_id AS jobCardId FROM unit1_production_runs WHERE id=? FOR UPDATE',[id]);
 if(!run)throw Object.assign(new Error('Production run not found.'),{status:404});
 if(run.status!=='setup'||!run.jobCardId)throw Object.assign(new Error('Only an unapproved setup coil can be unassigned.'),{status:409});
 await connection.execute("UPDATE unit1_production_runs SET status='returned',last_resumed_at=NULL,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[id]);
 await connection.execute("INSERT INTO unit1_production_events(run_id,event_type,note,actor_user_id) VALUES (?,'coil_returned','Setup coil released from machine; all production and inspection history retained.',?)",[id,actorId]);
 return {removed:true,historyRetained:true};
}
module.exports={removeSetupCoil};
