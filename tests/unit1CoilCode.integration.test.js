const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
test('short IDs and old QR references identify the same coil; manual assignment works without generating a QR', {skip:process.env.UNIT1_COIL_CODE_DB_TEST!=='1'},async()=>{
  require('dotenv').config({quiet:true});
  assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));
  const db=require('../config/unit1Db'),{assignCoilCode}=require('../services/unit1CoilCode');
  const c=await db.getConnection();
  const load=file=>{
    const routes={},source=path.join(__dirname,'../routes',file),localRequire=createRequire(source);
    const router={use(){},get:(p,...h)=>routes['GET '+p]=h.at(-1),post:(p,...h)=>routes['POST '+p]=h.at(-1),put(){},delete(){}};
    const mocks={express:{Router:()=>router},'../config/unit1Db':c,'../middleware/unit1AuthMiddleware':()=>{},'../middleware/roleMiddleware':()=>()=>{},'./unit1JobCardRoutes':{}};
    vm.runInNewContext(fs.readFileSync(source,'utf8'),{require:name=>mocks[name]||localRequire(name),module:{exports:{}}});
    return routes;
  };
  const call=async(handler,req)=>{let error;const res={statusCode:200,status(code){this.statusCode=code;return this},json(value){this.body=value;return this}};await handler({...req,user:{role:'superadmin'}},res,e=>error=e);if(error)throw error;return res};
  try{
    await c.beginTransaction();
    const legacy='U1-code-test-'+Date.now();
    const [insert]=await c.execute(`INSERT INTO coils (internal_id,supplier,supplier_coil_id,grade,material_type,coil_qty,thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,status) VALUES (?,'Test',?,'E350','MS',2,3,254,2000,2000,0,2000,'in_stock')`,[legacy,legacy]);
    const code=await assignCoilCode(c,insert.insertId,legacy);
    await require('../services/unit1PhysicalCoils').ensurePhysicalCoils(c,insert.insertId,2);
    const [[physical]]=await c.execute('SELECT CAST(code AS CHAR) AS code FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number=2',[insert.insertId]);
    const scans=load('unit1CoilRoutes.js');
    for(const ref of [legacy,code]){
      const result=await call(scans['GET /scan/:internalId/:coilNumber'],{params:{internalId:ref,coilNumber:'2'}});
      assert.equal(result.statusCode,200);assert.equal(result.body.data.coilId,insert.insertId);assert.equal(result.body.data.reference,physical.code);
    }
    const invalid=await call(scans['GET /scan/:internalId/:coilNumber'],{params:{internalId:code,coilNumber:'3'}});assert.equal(invalid.statusCode,404);
    const [[machine]]=await c.execute('SELECT id FROM unit1_machines LIMIT 1');
    const [job]=await c.execute(`INSERT INTO unit1_job_cards (job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,machine_id,planned_machine_id,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by) VALUES ('2026-10-19','Test','Test',100,'solar_mounting_structure','Test','150x65','day',2300,?,?,'MS',254,3,'12x20',1)`,[machine.id,machine.id]);
    const production=load('unit1ProductionRoutes.js');
    const verified=await call(production['POST /verify-coil'],{body:{jobCardId:job.insertId,coilId:insert.insertId,coilNumber:2}});
    assert.equal(verified.statusCode,200);assert.equal(verified.body.data.compatible,true);
    await c.execute('UPDATE unit1_job_cards SET coil_width_mm=300 WHERE id=?',[job.insertId]);
    const mismatch=await call(production['POST /verify-coil'],{body:{jobCardId:job.insertId,coilId:insert.insertId,coilNumber:2}});assert.equal(mismatch.statusCode,409);
    await assignCoilCode(c,insert.insertId);
    const [[saved]]=await c.execute('SELECT internal_id,supplier_coil_id,public_code FROM coils WHERE id=?',[insert.insertId]);
    assert.match(saved.internal_id,/^[1-9]\d{5}$/);assert.equal(saved.internal_id,saved.public_code);assert.equal(saved.supplier_coil_id,saved.public_code);
  }finally{await c.rollback();c.release();await db.end()}
});
