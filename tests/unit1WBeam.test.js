const test=require('node:test'),assert=require('node:assert/strict');
const {material}=require('../services/unit1Planning');
const {holeScrapKg,theoreticalWeightKg}=require('../services/unit1MaterialWeight');
const spec={structureType:'w_beam_crash_barrier',memberName:'W beam',sectionSize:'312 x 83',cutLengthMm:4320,materialType:'GP',coilWidthMm:482,coilThicknessMm:3,punchSize:'18x30',holes:[{punchSize:'18x30',profile:'beam',targetMm:100},{punchSize:'18x30',profile:'beam',targetMm:4220}]};
test('W-beam uses absolute positions from end zero and does not require solar faces',()=>{
 const v=material(spec);assert.deepEqual(v.holes.map(h=>[h.profile,h.targetMm]),[['beam',100],['beam',4220]]);
 assert.throws(()=>material({...spec,holes:[{profile:'beam',targetMm:4321}]}),/within cut length/);
 assert.throws(()=>material({...spec,structureType:'solar_mounting_structure'}),/valid punch positions/);
});
test('editing an old W-beam template converts face labels without inventing positions or quantities',()=>{
 const v=material({...spec,holes:spec.holes.map(h=>({...h,profile:'web'}))});
 assert.deepEqual(v.holes.map(h=>h.targetMm),[100,4220]);assert.ok(v.holes.every(h=>h.profile==='beam'));
 assert.equal('productionQty' in v,false);
});
test('W-beam calculations use coil strip width and count physical holes once per piece',()=>{
 const v=material(spec),pieces=10,densityGcm3=7.85;
 assert.equal(theoreticalWeightKg({widthMm:482,thicknessMm:3,lengthMm:4320,pieces,densityGcm3}),490.36752);
 const area=18*(30-18)+Math.PI*9**2;
 assert.ok(Math.abs(holeScrapKg({holes:v.holes,thicknessMm:3,pieces,densityGcm3})-area*2*3*10*7.85/1e6)<1e-9);
});

