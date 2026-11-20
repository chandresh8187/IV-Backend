const test=require('node:test'),assert=require('node:assert/strict');
const {DateTime}=require('luxon');
const {monthRange,allocateKg,summarizeMonthly}=require('../services/unit1MonthlyProduction');
const range=monthRange('2026-10');
test('month follows Indian operating dates including year rollover',()=>{
 assert.equal(monthRange(null,DateTime.fromISO('2026-10-31T20:00:00Z')).month,'2026-11');
 assert.equal(monthRange('2026-12').end,'2027-01-01');assert.throws(()=>monthRange('2026-13'),{status:400});
});
test('open coils show used minus known hole scrap and mark other scrap pending',()=>{
 const s=summarizeMonthly(range,[{settlementId:null,usedKg:1000,holeKg:20,bundleCount:2,unknownHoles:0}],[]);
 assert.equal(s.productionTonnes,.98);assert.equal(s.otherScrapKg,null);assert.equal(s.isEstimated,true);assert.equal(s.pendingBundles,2);
});
test('blade scrap is subtracted once in estimates and classified within total measured scrap',()=>{
 const row={usedKg:1010,holeKg:20,bladeKg:10,bundleCount:1,unknownHoles:0};
 const open=summarizeMonthly(range,[{...row,settlementId:null}],[]);
 assert.equal(open.productionKg,980);assert.equal(open.cutBladeScrapKg,10);
 const closed=summarizeMonthly(range,[{...row,settlementId:7}],[{settlementId:7,month:range.month,usedKg:1010,startingKg:1010,materialKg:950}]);
 assert.equal(closed.productionKg,950);assert.equal(closed.otherScrapKg,30);
});
test('settled coils subtract total scrap once and split final material across production months by usage',()=>{
 const groups=[{settlementId:7,month:'2026-09',usedKg:600,startingKg:1000,materialKg:750},{settlementId:7,month:'2026-10',usedKg:400,startingKg:1000,materialKg:750}];
 const s=summarizeMonthly(range,[{settlementId:7,usedKg:400,holeKg:20,bundleCount:2,unknownHoles:0}],groups);
 assert.equal(s.coilUsedKg,400);assert.equal(s.productionKg,300);assert.equal(s.otherScrapKg,80);
 assert.equal(s.productionKg,s.coilUsedKg-s.holeScrapKg-s.otherScrapKg);assert.equal(s.isEstimated,false);
 const both=allocateKg(750,groups);assert.equal(both['2026-09']+both['2026-10'],750);
 const corrected=summarizeMonthly(range,[{settlementId:7,usedKg:400,holeKg:20,bundleCount:2,unknownHoles:0}],groups.map(row=>({...row,materialKg:800})));
 assert.equal(corrected.productionKg,320);
});
test('mixed production sums allocated confirmed output and pending estimate without counting grouped coils twice',()=>{
 const s=summarizeMonthly(range,[{settlementId:7,usedKg:400,holeKg:20,bundleCount:2,unknownHoles:0},{settlementId:null,usedKg:200,holeKg:5,bundleCount:1,unknownHoles:0}],[{settlementId:7,month:'2026-10',usedKg:400,startingKg:500,materialKg:350}]);
 assert.equal(s.productionKg,545);assert.equal(s.confirmedProductionKg,350);assert.equal(s.estimatedProductionKg,195);
});
test('unknown punching scrap does not become invented zero, but confirmed weighbridge output stays known',()=>{
 const unknown={settlementId:null,usedKg:200,holeKg:0,bundleCount:1,unknownHoles:1};
 assert.equal(summarizeMonthly(range,[unknown],[]).productionKg,null);
 const closed=summarizeMonthly(range,[{...unknown,settlementId:1}],[{settlementId:1,month:'2026-10',usedKg:200,startingKg:250,materialKg:190}]);
 assert.equal(closed.productionKg,190);assert.equal(closed.holeScrapKg,null);assert.equal(closed.otherScrapKg,null);
});
test('gram rounding preserves exact group totals and an empty month is zero',()=>{
 const rows=[{month:'2026-08',usedKg:1},{month:'2026-09',usedKg:1},{month:'2026-10',usedKg:1}];
 assert.deepEqual(allocateKg(1,rows),{'2026-08':.334,'2026-09':.333,'2026-10':.333});
 assert.equal(summarizeMonthly(range,[],[]).productionTonnes,0);
});
