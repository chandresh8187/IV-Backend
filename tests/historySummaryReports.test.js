const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
let DatabaseSync;
try { ({DatabaseSync}=require('node:sqlite')); } catch {}
function fixture() {
 const db=new DatabaseSync(':memory:');
 db.function('DATE_FORMAT',(value,format)=>String(value).slice(0,format.includes('%H')?19:10));
 const columns=['id','shift_id','shift_date','shift_name','sr_no','production_time','pickling_duration_seconds','flux_duration_seconds','hot_drier_duration_seconds','zinc_kettle_duration_seconds','challan_no','party_name','material','dipping_qty','kettle_temperature','ms_weight','gi_weight','zinc_percentage','production_weight','c1','c2','c3','c4','c5','avg_coating','item_id','planning_id','planning_item_id','row_type'];
 db.exec(`CREATE TABLE production_entries (${columns.map(c=>c+' '+(['shift_date','shift_name','material','row_type','challan_no'].includes(c)?'TEXT':'NUMERIC')).join(',')}); CREATE TABLE production_planning_items (id INTEGER,planning_id INTEGER,item_id INTEGER,material_description TEXT);`);
 db.exec(`INSERT INTO production_planning_items VALUES (1,100,9,'Beam description'),(2,100,10,'Other beam');`);
 const insert=db.prepare(`INSERT INTO production_entries (id,shift_date,shift_name,challan_no,material,dipping_qty,ms_weight,gi_weight,item_id,planning_id,planning_item_id,row_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
 insert.run(1,'2026-10-16','night','DC/123','BEAM 4mm',2,10,11,null,100,1,'entry');
 insert.run(2,'2026-10-16','night','DC/123','BEAM 6mm',1,20,22,9,100,1,'entry');
 insert.run(3,'2026-10-16','night','DC/123','BEAM',5,50,55,10,100,2,'entry');
 insert.run(4,'2026-10-15','day','DC/123','BEAM',5,50,55,9,100,1,'entry');
 const reports=[],module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/productionReportController.js'),'utf8'),{module,Buffer,console,require:name=>name==='../config/db'?{query:async(sql,params)=>[db.prepare(sql).all(...params)]}:{generateProductionPdf:async input=>{reports.push(input);return Buffer.from('pdf');}}});
 const run=async query=>{const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){},end(){return this;}};await module.exports.generateProductionReport({query},res);return res;};
 return {db,reports,run,filter:module.exports.getReportFilter};
}
test('material report includes planning-linked legacy entries, excludes other IDs and dates, and weights each entry', {skip:!DatabaseSync},async()=>{
 const f=fixture();try{
  assert.equal((await f.run({type:'material',value:'MS BEAM',item_id:9,date:'2026-10-16',shift_name:'night'})).code,200);
  assert.deepEqual(Array.from(f.reports[0].tableData,r=>r.id),[1,2]);
  assert.equal(f.reports[0].summary.total_ms_production_kg,40);
  assert.equal(f.reports[0].summary.total_gi_production_kg,44);
 }finally{f.db.close();}
});
test('history planning PDF is restricted to the selected item/date/shift; lifetime exports stay available without date', {skip:!DatabaseSync},async()=>{
 const f=fixture();try{
  const args={type:'challan',value:'DC/123',planning_id:100,planning_item_id:1,date:'2026-10-16',shift_name:'night'};
  assert.equal((await f.run(args)).code,200);
  assert.deepEqual(Array.from(f.reports[0].tableData,r=>r.id),[1,2]);
  assert.equal((await f.run({...args,date:undefined,shift_name:undefined})).code,200);
  assert.deepEqual(Array.from(f.reports[1].tableData,r=>r.id),[4,1,2]);
 }finally{f.db.close();}
});
test('malformed IDs cannot silently broaden a summary report', {skip:!DatabaseSync},async()=>{
 const f=fixture();try{
  for(const item_id of ['bad',0,-1,1.5])assert.equal((await f.run({type:'material',value:'MS BEAM',date:'2026-10-16',item_id})).code,400);
  assert.equal(f.reports.length,0);
 }finally{f.db.close();}
});


test('material summary returns named master materials, quantities and weighted totals for the selected shift', {skip:!DatabaseSync},async()=>{
 const f=fixture();try{
  f.db.exec("CREATE TABLE items (id INTEGER,item_name TEXT); INSERT INTO items VALUES (9,'MS BEAM'),(10,'MS COLUMN');");
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/productionHistoryController.js'),'utf8'),{module,console,require:()=>({query:async(sql,params)=>{
   // SQLite has no MySQL ORDER BY/SEPARATOR syntax inside GROUP_CONCAT;
   // adapt just that presentation aggregate, keeping grouping/filters intact.
   const compatible=sql.replace(/GROUP_CONCAT\(DISTINCT[\s\S]*?AS material_descriptions,/, "GROUP_CONCAT(DISTINCT NULLIF(COALESCE(ppi.material_description, pe.material), '')) AS material_descriptions,");
   return [f.db.prepare(compatible).all(...params)];
  }})});
  const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await module.exports.getHistoryMaterialSummary({query:{date:'2026-10-16',shift_name:'night'}},res);
  assert.equal(res.code,200);
  const beam=res.body.data.find(row=>row.item_id===9);
  assert.equal(beam.material_name,'MS BEAM');
  assert.equal(beam.total_production_qty,3);
  assert.equal(beam.night_produced_qty,3);
  assert.equal(beam.day_produced_qty,0);
  assert.equal(beam.total_ms_production_kg,40);
  assert.equal(res.body.data.length,2);
 }finally{f.db.close();}
});
