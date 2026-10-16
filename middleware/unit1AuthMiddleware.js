const jwt = require('jsonwebtoken');
const db = require('../config/unit1Db');

module.exports = async (req, res, next) => {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  let decoded;
  try {
    decoded = jwt.verify(header.slice(7).trim(), process.env.JWT_SECRET, { issuer: 'iv-api', audience: 'iv-unit1' });
    if (decoded.scope !== 'unit1') throw new Error('Invalid scope');
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  try {
    const [users] = await db.query('SELECT id, role, assigned_shift, assigned_machine_id, status FROM users WHERE id = ? LIMIT 1', [decoded.id]);
    if (!users.length || users[0].status !== 'active') return res.status(401).json({ success: false, message: 'Your session is no longer active' });
    req.user = { id: users[0].id, role: users[0].role, assigned_shift: users[0].assigned_shift, assignedMachineId: users[0].assigned_machine_id, scope: 'unit1' };
    req.authDb = db;
    next();
  } catch (error) { next(error); }
};
