const test=require('node:test'),assert=require('node:assert/strict');
const {rejectionWeight}=require('../services/unit1RejectedMaterial');
const {validateRejectedLines}=require('../services/unit1RejectedLines');
const {validateInspection}=require('../services/unit1HoleReports');

const coil={widthMm:298,thicknessMm:2,cutLengthMm:2300,densityGcm3:7.85,cutBladeSizeMm:5,cutBladeThicknessMm:2};
const holes=[{punchSize:'12x20'}];
const lines=[{cutLengthMm:2100,pieces:2},{cutLengthMm:2400,pieces:2},{cutLengthMm:2200,pieces:1}];
test('actual length times NOS determines blank usage, plus one blade cut per rejected piece',()=>{
 const weight=rejectionWeight(coil,holes,5,lines),factor=298*2*7.85/1000000;
 assert.equal(weight.rejectedUsedKg,Number((factor*(11200+25)).toFixed(4)));
 assert.equal(weight.rejectedCutBladeScrapKg,Number((factor*25).toFixed(4)));
 assert.equal(weight.rejectedHoleScrapKg,rejectionWeight(coil,holes,5).rejectedHoleScrapKg);
 assert.notEqual(weight.rejectedUsedKg,rejectionWeight(coil,holes,5).rejectedUsedKg);
 assert.equal(weight.rejectionWeightInputs.lines.length,3);
 assert.equal(weight.rejectedLines[0].cutLengthMm,2100);
});
test('template cut-length corrections preserve entered rejected lengths, legacy weights retain fallback',()=>{
 const weight=rejectionWeight(coil,holes,5,lines);
 assert.deepEqual(rejectionWeight({...coil,cutLengthMm:3000},holes,5,weight.rejectedLines),weight);
 assert.notEqual(rejectionWeight({...coil,cutLengthMm:3000},holes,5).rejectedUsedKg,rejectionWeight(coil,holes,5).rejectedUsedKg);
});
test('summing raw weights makes line splitting independent of rounding',()=>{
 const input={...coil,widthMm:142.123,thicknessMm:1.123};
 const one=rejectionWeight(input,holes,100,[{cutLengthMm:2100.123,pieces:100}]);
 const many=rejectionWeight(input,holes,100,Array.from({length:100},()=>({cutLengthMm:2100.123,pieces:1})));
 assert.equal(one.rejectedUsedKg,many.rejectedUsedKg);assert.equal(one.rejectedWeightKg,many.rejectedWeightKg);
});
test('malformed lines, excessive counts and mismatched totals fail before saving',()=>{
 for(const value of [null,{},[],Array(201).fill(lines[0]),[{cutLengthMm:-1,pieces:1}],[{cutLengthMm:1.1234,pieces:1}],[{cutLengthMm:1000001,pieces:1}],[{cutLengthMm:1,pieces:1.1}],[{cutLengthMm:1,pieces:100000},{cutLengthMm:1,pieces:1}]])assert.throws(()=>validateRejectedLines(value),{status:400});
 assert.throws(()=>rejectionWeight(coil,holes,3,lines),{status:409});
});
test('normalized length inputs participate in idempotency; scalar-only old clients keep their existing hash',()=>{
 const base={approved:true,entryKind:'rejection',measurements:[],requestKey:'reject_lines_123',rejectedPieces:5};
 const legacy=validateInspection(base);
 const first=validateInspection({...base,rejectedLines:lines});
 assert.notEqual(first.requestHash,legacy.requestHash);
 assert.equal(first.requestHash,validateInspection({...base,rejectedLines:lines.map(line=>({cutLengthMm:String(line.cutLengthMm),pieces:String(line.pieces)}))}).requestHash);
 assert.notEqual(first.requestHash,validateInspection({...base,rejectedLines:[{cutLengthMm:2300,pieces:5}]}).requestHash);
});
