const test=require('node:test');
const assert=require('node:assert/strict');
const {allocateStock,decorateRows,validateStockChange}=require('../services/unit1CoilStock');
test('stock allocation totals exact grams and excludes finished coils without changing actual inputs',()=>{
 const positions=[{coilId:1,coilNumber:1,startingKg:1000,usedKg:50,remainingKg:950},{coilId:1,coilNumber:2,startingKg:1000,usedKg:0,remainingKg:1000},{coilId:1,coilNumber:3,startingKg:1000,usedKg:900,closed:true,remainingKg:0}];
 const result=allocateStock(1800.123,positions);assert.equal(result.length,2);assert.equal(result.reduce((n,r)=>n+Math.round(r.remainingKg*1000),0),1800123);assert.equal(positions[0].startingKg,1000);
 assert.throws(()=>allocateStock(1,[{closed:true}]),/finished/);
});
test('confirmed balance for unknown inward stays separate from original starting weight',()=>{
 const [allocation]=allocateStock(500,[{coilId:2,coilNumber:1,startingKg:null,usedKg:10,remainingKg:null}]);assert.equal(allocation.adjustmentKg,510);
 const [row]=decorateRows([{id:2,weightRecorded:0,totalWeightKg:null}],[{coilId:2,coilNumber:1,known:true,remainingKg:500,confirmed:1}]);assert.equal(row.stockRemainingKg,500);assert.equal(row.totalWeightKg,null);
});
test('negative stock, missing reasons and malformed stale record references are rejected',()=>{
 const valid={materialType:"MS",grade:"E350",widthMm:298,thicknessMm:2,targetKg:0,reason:'Count correction',requestKey:'stock_test_123',expected:[{id:1,fingerprint:'a'.repeat(64)}]};assert.equal(validateStockChange(valid,'adjust').targetKg,0);
 for(const patch of [{targetKg:-1},{reason:' '},{expected:[]}])assert.throws(()=>validateStockChange({...valid,...patch},'adjust'));
});
