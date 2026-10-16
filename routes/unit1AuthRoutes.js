const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const { getUserAccess } = require('../services/permissionService');

const router = express.Router();
const publicUser = async (user) => {
  const access = await getUserAccess({ userId: user.id, role: user.role, queryable: db, scope: 'unit1' });
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    assigned_shift: user.assigned_shift, assignedMachineId: user.assigned_machine_id, scope: 'unit1',
    permissions: access.allowedKeys.filter(key => key.startsWith('unit1.')) };
};

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required' });
    const [users] = await db.query('SELECT id, name, email, password, role, assigned_shift, assigned_machine_id, status FROM users WHERE email = ? LIMIT 1', [email]);
    const user = users[0];
    if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    const token = jwt.sign({ id: user.id, role: user.role, scope: 'unit1' }, process.env.JWT_SECRET,
      { issuer: 'iv-api', audience: 'iv-unit1', expiresIn: '30d' });
    res.json({ success: true, message: 'Login successful', token, user: await publicUser(user) });
  } catch (error) { next(error); }
});

router.get('/profile', auth, async (req, res, next) => {
  try {
    const [users] = await db.query('SELECT id, name, email, role, assigned_shift, assigned_machine_id FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    res.json({ success: true, user: await publicUser(users[0]) });
  } catch (error) { next(error); }
});

module.exports = router;
