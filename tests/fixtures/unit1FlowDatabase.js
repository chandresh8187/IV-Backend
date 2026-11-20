const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{randomBytes}=require('node:crypto');
async function unit1FlowDatabase(){
 require('dotenv-flow').config({silent:true});
 const mysql=require('mysql2/promise');
 const config={host:process.env.UNIT1_DB_HOST||process.env.DB_HOST,port:Number(process.env.UNIT1_DB_PORT||process.env.DB_PORT)||3306,user:process.env.UNIT1_DB_USER||process.env.DB_USER,password:process.env.UNIT1_DB_PASSWORD??process.env.DB_PASSWORD,decimalNumbers:true};
 if(!['127.0.0.1','localhost','::1'].includes(config.host))throw Error('Disposable localhost database required.');
 const name='unit1_flow_audit_test_'+Date.now()+'_'+randomBytes(4).toString('hex');
 if(!/^unit1_flow_audit_test_\d+_[a-f0-9]{8}$/.test(name))throw Error('Invalid disposable database name.');
 const root=await mysql.createConnection(config);let db,created=false;
 const close=async()=>{try{if(db)await db.end();if(created)await root.query('DROP DATABASE `'+name+'`');}finally{await root.end();}};
 try{
  await root.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');created=true;await root.query('USE `'+name+'`');
  const sql=fs.readFileSync(path.join(__dirname,'../../database/u436685010_iv1_app_clean_install.sql'),'utf8').replace(/^--.*$/gm,'').replace('USE `u436685010_iv1_app`','USE `'+name+'`');
  for(const statement of sql.split(/;\s*(?:\r?\n|$)/).map(s=>s.trim()).filter(Boolean))await root.query(statement);
  db=mysql.createPool({...config,database:name});
  const file=path.join(__dirname,'../../scripts/migrateUnit1Coils.js'),localRequire=createRequire(file),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,console,process,require:n=>n==='../config/unit1Db'?db:localRequire(n)},{filename:file});await mod.exports.migrateUnit1Coils();
  await db.query("INSERT INTO unit1_machines(id,code,name,is_active) VALUES(1,'AUDIT-FORMER','Audit former',1)");
  await db.query("INSERT INTO coils(internal_id,supplier_coil_id,supplier,grade,material_type,width_mm,thickness_mm,coil_qty,gross_kg,tare_kg,estimated_kg,actual_net_kg,qr_generated_at) VALUES('AUDIT-COIL','AUDIT-COIL','Test supplier','E250','MS',254,3,3,3000,0,3000,3000,UTC_TIMESTAMP(3))");
  return {db,close};
 }catch(error){await close();throw error;}
}
module.exports={unit1FlowDatabase};
