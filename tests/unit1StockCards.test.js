const test=require('node:test'),assert=require('node:assert/strict');
const {specKey,createCard,listCards}=require('../services/unit1StockCards');
test('stock card key normalizes numeric dimensions and grade casing but separates material and grade',()=>{const v={materialType:'MS',grade:'E350',widthMm:298,thicknessMm:2};assert.equal(specKey(v),specKey({...v,materialType:' ms ',grade:'e350',widthMm:'298.000'}));assert.notEqual(specKey(v),specKey({...v,grade:'E250'}));assert.notEqual(specKey(v),specKey({...v,materialType:'GL'}));});
test('local stock card invoices add whole inward weights; empty card delete and history are audited',{skip:process.env.UNIT1_PHYSICAL_COIL_DB_TEST!=='1'},async()=>{
 require('dotenv-flow').config({silent:true});assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));
 const db=require('../config/unit1Db'),c=await db.getConnection();
 try{await c.beginTransaction();const [[actor]]=await c.execute('SELECT id FROM users LIMIT 1');const spec={materialType:'MS',grade:'E350',widthMm:98765.123,thicknessMm:2};
 const [[before]]=await c.execute('SELECT COUNT(*) n FROM coils');await createCard(c,spec,actor.id);await createCard(c,spec,actor.id);const [[after]]=await c.execute('SELECT COUNT(*) n FROM coils');assert.equal(after.n,before.n);
 const cards=(await listCards(c)).filter(r=>Number(r.widthMm)===spec.widthMm);assert.equal(cards.length,1);assert.equal(cards[0].stockCardOnly,true);
 const {createInvoice}=require('../services/unit1CoilInvoices');const {stockPositions,changeStock}=require('../services/unit1CoilStock');
 const body={vendorCode:'CARD-TEST',tcNumber:'TC-CARD',invoice:'INV-CARD-TEST',totalWeightKg:6000,lines:[{...spec,coilQty:3,ratePerKg:60,totalWeightKg:6000}]};
 const a=await createInvoice(c,{...body,requestId:'card_test_a_'+Date.now()},actor.id),b=await createInvoice(c,{...body,requestId:'card_test_b_'+Date.now()},actor.id);const positions=await stockPositions(c,[a.lines[0].id,b.lines[0].id]);assert.equal(positions.reduce((n,p)=>n+p.remainingKg,0),12000);assert.equal(positions.length,2);assert.equal(a.lines[0].totalWeightKg,6000);
 const empty={...spec,grade:'E250'};await createCard(c,empty,actor.id);await changeStock(c,{...empty,reason:'Empty test card',requestKey:'empty_card_test_'+Date.now(),expected:[]},'delete',actor.id);assert.equal((await listCards(c)).some(r=>Number(r.widthMm)===spec.widthMm&&r.grade==='E250'),false);
 const [[audit]]=await c.execute('SELECT COUNT(*) n FROM unit1_coil_stock_changes WHERE reason=?',['Empty test card']);assert.ok(audit.n>0);
 }finally{await c.rollback();c.release();await db.end();}
});
