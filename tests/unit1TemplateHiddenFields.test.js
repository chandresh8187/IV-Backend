const test=require('node:test'),assert=require('node:assert/strict');
const {material}=require('../services/unit1Planning');
const input=()=>({memberName:'C PURLIN',sectionSize:'100x50x20',cutLengthMm:2500,materialType:'MS',allowedCoilSizes:[{widthMm:298,thicknessMm:3}],holes:[{punchSize:'65x20',punchName:null,profile:'web',targetMm:100}]});
test('section face validation retains separate punch sizes and sides', () => {
  const body = input();
  const holes = ['l_lip', 'r_lip'].map((profile, index) => ({
    ...body.holes[0], profile, punchSize: index ? '12' : '9x20',
  }));
  const saved = material({ ...body, sectionProfile: 'c_lip', holes });
  assert.deepEqual(saved.holes.map(h => [h.profile, h.punchSize]), [['l_lip', '9x20'], ['r_lip', '12']]);
  assert.throws(() => material({ ...body, sectionProfile: 'flat', holes }), /supported by the selected section/);
  assert.equal(material({ ...body, sectionProfile: 'c_lip', holes: [{ ...holes[0], profile: 'lip' }] }).holes[0].profile, 'lip');
});
test('WEB holes at the same longitudinal position retain independent signed offsets', () => {
  const body = input();
  body.holes = ['-20', '+20'].map(centerOffsetMm => ({ ...body.holes[0], centerOffsetMm }));
  const saved = material(body);
  const { groupPunchRequirements } = require('../services/unit1PunchRequirements');
  assert.deepEqual(groupPunchRequirements(saved).map(group => [group.positions, group.centerOffsetMm]), [[[100], -20], [[100], 20]]);
  assert.throws(() => material({ ...body, holes: [{ ...body.holes[0], centerOffsetMm: '-20.1234' }] }), /centre offset/);
});
test('new template without removed product or punch-name selections derives hidden compatibility fields',()=>{const v=material(input());assert.equal(v.structureType,'solar_mounting_structure');assert.equal(v.punchSize,'65x20');assert.equal(v.memberName,'C PURLIN');assert.equal(v.holes[0].punchName,null);assert.equal(v.holes[0].targetMm,100);});
test('missing actual material input reports its visible field and never fabricates dimensions',()=>{for(const [key,label]of [['memberName','Structure Type'],['sectionSize','Section size'],['materialType','Coil material']])assert.throws(()=>material({...input(),[key]:''}),new RegExp(label));assert.throws(()=>material({...input(),holes:[{profile:'web',targetMm:100}]}),/Punch size/);});
test('existing W beam geometry and legacy named punches are preserved',()=>{const v=material({...input(),structureType:'w_beam_crash_barrier',sectionSize:'310x85',holes:[{punchName:'C',punchSize:'65x20',profile:'beam',targetMm:100}]});assert.equal(v.structureType,'w_beam_crash_barrier');assert.equal(v.holes[0].punchName,'C');assert.equal(v.holes[0].profile,'beam');});
