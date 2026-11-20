const test=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../services/unit1StockRegister');
test('stock register groups exact specifications and includes usage and pending weights without dividing by coil count',()=>{
 const r={widthMm:298,thicknessMm:2,materialType:'MS',grade:'E350',weightRecorded:1,totalWeightKg:6000,receivedAt:'2026-11-06'};
 const result=summarize([{...r,id:1},{...r,id:2},{...r,id:3,grade:'E250',weightRecorded:0,totalWeightKg:null}],[{coilId:1,usedKg:1000,remainingKg:5000},{coilId:2,usedKg:500,remainingKg:5500},{coilId:3,usedKg:0,remainingKg:null}]);
 const stock=result.find(g=>g.grade==='E350');assert.equal(stock.receivedKg,12000);assert.equal(stock.usedKg,1500);assert.equal(stock.availableKg,10500);assert.equal(stock.receiptCount,2);assert.equal(result.find(g=>g.grade==='E250').pendingWeights,1);
});

test('local stock receipt keeps invoice, rate and original full weight atomically',{skip:process.env.UNIT1_PHYSICAL_COIL_DB_TEST!=='1'},async()=>{
 require('dotenv-flow').config({silent:true});assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));const db=require('../config/unit1Db'),c=await db.getConnection();
 try{await c.beginTransaction();const [[actor]]=await c.execute('SELECT id FROM users LIMIT 1');const {addStock,listStock}=require('../services/unit1StockRegister');const body={materialType:'MS',grade:'E350',widthMm:98763.123,thicknessMm:2,totalWeightKg:10000,coilQty:5,ratePerKg:60,vendorCode:'REGISTER-TEST',tcNumber:'TC-REGISTER',invoice:'REG-TEST',requestId:'register_test_'+Date.now()};
 const saved=await addStock(c,body,actor.id);assert.equal(saved.lines[0].totalWeightKg,10000);assert.equal(saved.lines[0].ratePerKg,60);assert.equal(saved.invoice,'REG-TEST');assert.equal((await addStock(c,body,actor.id)).id,saved.id);
 await addStock(c,{...body,requestId:body.requestId+'_2',ratePerKg:65},actor.id);const row=(await listStock(c)).find(r=>r.widthMm===body.widthMm);assert.equal(row.receivedKg,20000);assert.equal(row.availableKg,20000);assert.equal(row.receiptCount,2);const multi=await addStock(c,{...body,requestId:body.requestId+'_multi',lines:[{...body,totalWeightKg:3000},{...body,widthMm:98762.123,totalWeightKg:2000,ratePerKg:65}]},actor.id);assert.equal(multi.lines.length,2);assert.equal(multi.totalWeightKg,5000);assert.equal(multi.lines[0].totalWeightKg,3000);assert.equal(multi.lines[1].ratePerKg,65);const invoices=await require('../services/unit1StockRegister').listInvoices(c,body);assert.equal(invoices.length,3);assert.ok(invoices.every(r=>Number(r.widthMm)===body.widthMm&&r.grade==='E350'));assert.deepEqual(invoices.map(r=>Number(r.ratePerKg)).sort(),[60,60,65]);await assert.rejects(require('../services/unit1StockRegister').listInvoices(c,{}),{status:400});const [[qr]]=await c.execute('SELECT qr_generated_at generated FROM coils WHERE id=?',[saved.lines[0].id]);assert.equal(qr.generated,null);
 }finally{await c.rollback();c.release();await db.end();}
});

test('ERP invoice sums exact line weights and refuses empty or unweighed lines',()=>{const {invoiceBody}=require('../services/unit1StockRegister');const body=invoiceBody({invoice:'I',lines:[{totalWeightKg:'10000.123'},{totalWeightKg:'5000.456'}]});assert.equal(body.totalWeightKg,15000.579);assert.equal(body.lines.length,2);assert.throws(()=>invoiceBody({lines:[]}),/Add 1 to 50/);assert.throws(()=>invoiceBody({lines:[{totalWeightKg:''}]}),/actual weight/);});

test('size suggestions combine different-collation sources without UNION and deduplicate normalized specifications',async()=>{
 const queries=[];const c={execute:async sql=>{queries.push(sql);return [sql.includes('unit1_coil_stock_cards')?[{materialType:'MS',grade:'E350',widthMm:'298.000',thicknessMm:'2.000'}]:[{materialType:'ms',grade:'e350',widthMm:298,thicknessMm:2},{materialType:'GP',grade:'GSM - 120',widthMm:300,thicknessMm:2}]];}};
 const rows=await require('../services/unit1StockRegister').listSizes(c);assert.equal(queries.length,2);assert.ok(queries.every(sql=>!sql.includes('UNION')));assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.widthMm),[298,300]);
});
