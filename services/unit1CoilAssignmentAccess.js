const jwt = require('jsonwebtoken');
const { hasPermission } = require('./permissionService');

const audience = 'iv-unit1-coil-assignment';

function scanProof(userId, coil) {
  return jwt.sign(coil, process.env.JWT_SECRET, { subject: String(userId), audience, expiresIn: '10m' });
}

function matchesScanProof(token, userId, { stockQrId, coilId, coilNumber }) {
  try {
    const proof = jwt.verify(token, process.env.JWT_SECRET, { subject: String(userId), audience, algorithms: ['HS256'] });
    return stockQrId
      ? Number(proof.stockQrId) === Number(stockQrId)
      : !proof.stockQrId && Number(proof.coilId) === Number(coilId) && Number(proof.coilNumber) === Number(coilNumber);
  } catch {
    return false;
  }
}

async function requireAssignmentSource(req) {
  if (matchesScanProof(req.body?.scanProof, req.user.id, req.body || {})) return;
  if (await hasPermission({ userId: req.user.id, role: req.user.role, queryable: req.authDb, permissionKey: 'unit1.production.coil.assign.manual' })) return;
  throw Object.assign(new Error('Scan the coil QR to assign it. Manual Coil ID assignment is disabled.'), { status: 403 });
}

module.exports = { scanProof, matchesScanProof, requireAssignmentSource };
