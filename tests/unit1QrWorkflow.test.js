const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeAllowedCoilSizes,matchesAllowedCoilSize}=require('../services/unit1AllowedCoilSizes');
const {validateQrRecord}=require('../services/unit1CoilQrGenerator');
const {material,planInput}=require('../services/unit1Planning');
const sizes=[{widthMm:100,thicknessMm:1},{widthMm:254,thicknessMm:3}];
test('allowed sizes are independent from existing coil QR records and match width/thickness only',()=>{
 const allowedCoilSizes=normalizeAllowedCoilSizes({allowedCoilSizes:sizes});
 assert.equal(matchesAllowedCoilSize({materialType:'GP',grade:'Different',widthMm:254,thicknessMm:3},{materialType:'MS',allowedCoilSizes}),true);
 assert.equal(matchesAllowedCoilSize({widthMm:255,thicknessMm:3},{allowedCoilSizes}),false);
 assert.throws(()=>normalizeAllowedCoilSizes({allowedCoilSizes:[sizes[0],sizes[0]]}),/duplicate/);
 assert.throws(()=>normalizeAllowedCoilSizes({allowedCoilSizes:[{widthMm:0,thicknessMm:3}]}),/positive/);
 const spec=material({structureType:'solar_mounting_structure',memberName:'Column',sectionSize:'100',cutLengthMm:1000,materialType:'MS',punchSize:'10',holes:[{profile:'web',targetMm:20}],allowedCoilSizes});
 assert.deepEqual(spec.allowedCoilSizes,sizes);assert.equal(spec.coilWidthMm,100);
 assert.deepEqual(planInput({partyName:'Test',planDate:'2026-10-30',shift:'day',lines:[{templateId:1,machineId:1,quantity:64}]}).lines[0].selectedCoils,[]);
});
test('QR generator validates quantity, type, dimensions and rate without requesting starting weight',()=>{
 const row={materialType:'MS',grade:'E350',widthMm:'100',thicknessMm:'1',coilQty:'4',ratePerKg:'65.50',requestId:'qr_request_12345'};
 assert.equal(validateQrRecord(row).coilQty,4);assert.equal('actualNetKg' in validateQrRecord(row),false);
 for(const patch of [{coilQty:0},{widthMm:-1},{ratePerKg:0},{grade:''}])assert.throws(()=>validateQrRecord({...row,...patch}),{status:400});
});
