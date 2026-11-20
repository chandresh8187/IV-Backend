const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');

test('actual rejected lengths persist, deduct stock atomically, and survive template corrections', {skip:process.env.UNIT1_REJECTED_LINES_DB_TEST!=='1'},async()=>{
 require('dotenv-flow').config({silent:true});
 assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));
 const db=require('../config/unit1Db'),connection=await db.getConnection();
 const planning=require('../services/unit1Planning'),{stockPositions}=require('../services/unit1CoilStock');
 // All service and route transactions participate in this outer rollback.
 const scopedConnection={execute:connection.execute.bind(connection),query:connection.query.bind(connection),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
 const scopedDb={...scopedConnection,getConnection:async()=>scopedConnection};
 try{
  await connection.beginTransaction();
  const [[machine]]=await connection.query('SELECT id FROM unit1_machines LIMIT 1');
  const [[actor]]=await connection.query('SELECT id FROM users LIMIT 1');
  const spec={name:'Rejected actual lengths test',structureType:'solar_mounting_structure',memberName:'Rejected test',sectionSize:'150x65x20',cutLengthMm:2300,materialType:'MS',punchSize:'12x20',holes:[{profile:'web',punchSize:'12x20',targetMm:100}],allowedCoilSizes:[{widthMm:298,thicknessMm:2}]};
  const template=await planning.saveTemplate(scopedDb,null,spec,actor.id);
  const plan=await planning.savePlan(scopedDb,null,{partyName:'REJECTION LENGTH TEST',projectName:'',planDate:'2026-11-19',shift:'day',requestKey:'reject_plan_'+Date.now(),lines:[{templateId:template.id,machineId:machine.id,quantity:100}]},actor.id);
  const [[line]]=await connection.execute('SELECT job_card_id jobId FROM unit1_production_plan_lines WHERE plan_id=?',[plan.id]);
  const reference='Rejected-lines-'+Date.now();
  const [coil]=await connection.execute(`INSERT INTO coils (internal_id,supplier,supplier_coil_id,invoice,invoice_date,vendor_code,tc_number,grade,material_type,coil_qty,thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,rate_per_kg,status) VALUES (?,'Test',?,'Test invoice','2026-11-19','TEST','TEST-TC','TEST','MS',1,2,298,100,100,0,100,60,'in_stock')`,[reference,reference]);
  const [run]=await connection.execute("INSERT INTO unit1_production_runs(machine_id,coil_id,coil_number,job_card_id,product_type,status,created_by) VALUES(?,?,1,?,'solar_mounting_structure','running',?)",[machine.id,coil.insertId,line.jobId,actor.id]);
  const source=path.join(__dirname,'../routes/unit1ProductionRoutes.js'),localRequire=createRequire(source),routes={};
  const router={use(){},get(){},post:(route,...handlers)=>{routes[route]=handlers.at(-1);}};
  const mocks={express:{Router:()=>router},'../config/unit1Db':scopedDb,'../middleware/unit1AuthMiddleware':()=>{},'../middleware/roleMiddleware':()=>()=>{},'./unit1JobCardRoutes':{},'../services/unit1Realtime':{publishUnit1Change(){}}};
  vm.runInNewContext(fs.readFileSync(source,'utf8'),{require:name=>mocks[name]||localRequire(name),module:{exports:{}}},{filename:source});
  const save=async body=>{let error,result;await routes['/runs/:id/hole-check']({params:{id:String(run.insertId)},body,user:{id:actor.id,role:'superadmin'}},{json(value){result=value.data;},status(){return this;}},value=>{error=value;});if(error)throw error;return result;};
  const body={approved:true,entryKind:'rejection',measurements:[],requestKey:'reject_lines_'+Date.now(),rejectedLines:[{cutLengthMm:2100,pieces:2},{cutLengthMm:2400,pieces:2},{cutLengthMm:2200,pieces:1}]};
  const savedRun=await save(body);await save(body);
  assert.ok(Object.hasOwn(savedRun,'cutBladeSizeMm'),'live run exposes machine blade size for the app/web weight preview');
  const [[saved]]=await connection.execute('SELECT report_snapshot snapshot FROM unit1_hole_checks WHERE run_id=?',[run.insertId]);
  const snapshot=JSON.parse(saved.snapshot);
  assert.equal(snapshot.rejectedPieces,5);assert.equal(snapshot.rejectedLines.length,3);
  const [position]=await stockPositions(connection,[coil.insertId],true);
  assert.equal(position.usedKg,snapshot.rejectedUsedKg);assert.ok(Math.abs(position.remainingKg-(100-snapshot.rejectedUsedKg))<.00001);
  const [displayPosition]=await stockPositions(connection,[coil.insertId]);
  assert.equal(Number(displayPosition.usedKg),snapshot.rejectedUsedKg);
  assert.ok(Math.abs(displayPosition.remainingKg-position.remainingKg)<.00001);
  await assert.rejects(save({...body,requestKey:body.requestKey+'_too_many',rejectedLines:[{cutLengthMm:100000,pieces:1000}]}),{status:409});
  const [[count]]=await connection.execute('SELECT COUNT(*) n FROM unit1_hole_checks WHERE run_id=?',[run.insertId]);assert.equal(Number(count.n),1);
  await planning.saveTemplate(scopedDb,template.id,{...spec,version:1,cutLengthMm:3000},actor.id);
  const [[revised]]=await connection.execute('SELECT report_snapshot snapshot FROM unit1_hole_checks WHERE run_id=?',[run.insertId]);
  const after=JSON.parse(revised.snapshot);
  assert.equal(after.cutLengthMm,3000);assert.deepEqual(after.rejectedLines,snapshot.rejectedLines);assert.equal(after.rejectedUsedKg,snapshot.rejectedUsedKg);
  const [[revision]]=await connection.execute('SELECT before_data original FROM unit1_job_card_revisions WHERE id=?',[after.correctionRevisionId]);
  assert.deepEqual(JSON.parse(JSON.parse(revision.original).checks[0].reportSnapshot).rejectedLines,snapshot.rejectedLines);
  const {machineHoleReport}=require('../services/unit1HoleReports');
  const {DateTime}=require('luxon');
  const report=await machineHoleReport(connection,{machineId:machine.id,date:DateTime.now().setZone('Asia/Kolkata').toISODate(),entryKind:'rejection'});
  const reported=report.checks.find(check=>Number(check.runId)===run.insertId);
  assert.deepEqual(reported.rejectedLines,snapshot.rejectedLines);
  assert.equal(Number((await connection.execute('SELECT COUNT(*) n FROM unit1_production_bundles WHERE run_id=?',[run.insertId]))[0][0].n),0);
 }finally{await connection.rollback();connection.release();await db.end();}
});
