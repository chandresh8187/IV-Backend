const test = require('node:test');
const assert = require('node:assert/strict');
const { scanProof, requireAssignmentSource } = require('../services/unit1CoilAssignmentAccess');

test('manual permission off requires a matching signed scan for both QR types', async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'unit1-coil-assignment-test-secret';
  try {
    const req = {
      user: { id: 7, role: 'supervisor' },
      authDb: { query: async () => [[{ allowed: 0 }]] },
    };
    for (const coil of [{ stockQrId: 12 }, { coilId: 8, coilNumber: 1 }]) {
      req.body = coil;
      await assert.rejects(requireAssignmentSource(req), { status: 403 });
      req.body = { ...coil, scanProof: scanProof(7, coil) };
      await requireAssignmentSource(req);
      await assert.rejects(requireAssignmentSource({ ...req, user: { ...req.user, id: 9 } }), { status: 403 });
    }
    req.body = { coilId: 8, coilNumber: 2, scanProof: scanProof(7, { coilId: 8, coilNumber: 1 }) };
    await assert.rejects(requireAssignmentSource(req), { status: 403 });
    req.authDb.query = async () => [[{ allowed: 1 }]];
    await requireAssignmentSource(req);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});
