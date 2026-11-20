async function unit1DbTransaction(db,work){
 for(let attempt=0;attempt<3;attempt++){
  const connection=await db.getConnection();let retry=false;
  try{await connection.beginTransaction();const result=await work(connection);await connection.commit();return result;}
  catch(error){await connection.rollback();retry=attempt<2&&['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code);if(!retry)throw error;}
  finally{connection.release();}
  if(retry)await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));
 }
}
module.exports={unit1DbTransaction};
