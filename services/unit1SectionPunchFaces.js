const { beamPunchProfiles } = require('./unit1BeamPunchProfiles');

const faceLabels = {
  web: 'Web', l_flange: 'L flange', r_flange: 'R flange',
  lr_flange: 'L & R FLANGE',
  l_lip: 'Left lip', r_lip: 'Right lip', lip: 'Lip (legacy)',
  beam: 'From end (0 mm)', ...beamPunchProfiles,
};
const hatFaceLabels = {
  web: 'Crown', l_flange: 'Left sloping side', r_flange: 'Right sloping side',
  l_lip: 'Left mounting foot', r_lip: 'Right mounting foot',
};
const channelFaces = ['web', 'l_flange', 'r_flange'];
const lippedFaces = [...channelFaces, 'l_lip', 'r_lip', 'lip'];
const allowedFaces = {
  flat: ['web'],
  angle: ['web', 'r_flange'],
  channel: channelFaces,
  c_lip: lippedFaces,
  z_lip: lippedFaces,
  gl_hat_purlin: lippedFaces,
  w_beam: ['beam', ...Object.keys(beamPunchProfiles)],
};

function isPunchFace(face, sectionProfile) {
  return sectionProfile
    ? Object.hasOwn(allowedFaces, sectionProfile) && allowedFaces[sectionProfile].includes(face)
    : Object.hasOwn(faceLabels, face);
}

function punchFaceLabel(face, sectionProfile) {
  return (sectionProfile === 'gl_hat_purlin' ? hatFaceLabels[face] : null) || faceLabels[face] || face;
}

function sectionProfileForTemplate(template) {
  if (template.structureType === 'w_beam_crash_barrier') return 'w_beam';
  if (template.sectionProfile) return template.sectionProfile;
  if (template.structureType === 'gl_hat_purlin') return 'gl_hat_purlin';
  const section = String(template.sectionSize ?? '').trim();
  if (!section) return '';
  const count = section.split(/[x×*]/i).length;
  return count >= 3 ? 'c_lip' : count === 2 ? 'channel' : 'flat';
}

function expandPunchFaces(holes, sectionProfile) {
  if (!Array.isArray(holes)) return holes;
  return holes.flatMap(hole => {
    if (hole?.profile !== 'lr_flange') return [hole];
    if (!isPunchFace('l_flange', sectionProfile) || !isPunchFace('r_flange', sectionProfile)) {
      throw Object.assign(new Error('L & R FLANGE requires a section with both left and right flanges.'), { status: 400 });
    }
    return ['l_flange', 'r_flange'].map(profile => ({ ...hole, profile }));
  });
}

module.exports = { faceLabels, isPunchFace, punchFaceLabel, sectionProfileForTemplate, expandPunchFaces };
