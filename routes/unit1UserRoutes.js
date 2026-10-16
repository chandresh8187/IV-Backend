const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { getPermissionDefinition, getUserAccess } = require('../services/permissionService');
const { publishUnit1Change } = require('../services/unit1Realtime');

const roles = ['production_manager', 'plant_manager', 'admin', 'supervisor', 'labour'];
const columns = 'id,name,email,role,assigned_shift AS assignedShift,assigned_machine_id AS assignedMachineId,status,created_at AS createdAt';
const idOf = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const fail = (status, message) => Object.assign(new Error(message), { status });
const userFields = body => {
  const name = String(body?.name || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const role = String(body?.role || '').trim().toLowerCase();
  const shift = role === 'supervisor' ? String(body?.assignedShift || body?.assigned_shift || '').trim().toLowerCase() : null;
  if (name.length < 2 || name.length > 120) throw fail(400, 'Name must contain 2 to 120 characters.');
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  if (!roles.includes(role)) throw fail(400, 'Select a valid Unit 1 role.');
  if (role === 'supervisor' && !['day', 'night'].includes(shift)) throw fail(400, 'Select Day or Night shift for the supervisor.');
  return { name, email, role, assignedShift: shift ? shift[0].toUpperCase() + shift.slice(1) : null };
};
const getUser = async id => {
  const [[user]] = await db.execute(`SELECT ${columns} FROM users WHERE id=?`, [id]);
  return user;
};
const handleError = (error, next) => next(error.code === 'ER_DUP_ENTRY' ? fail(409, 'This email address is already registered.') : error);
const permissionGroup = key => {
  if (key.startsWith('unit1.production.') || key.startsWith('unit1.jobcards.')) return 'Production';
  if (key.startsWith('unit1.coils.')) return 'Coil stock';
  if (key.startsWith('unit1.materials.')) return 'Materials and grades';
  if (key.startsWith('unit1.machines.')) return 'Machines';
  if (key.startsWith('unit1.shifts.')) return 'Shifts';
  if (key.startsWith('unit1.qr.')) return 'QR settings';
  if (key.startsWith('unit1.users.')) return 'Users and access';
  return 'Other';
};
const groupOrder = ['Production', 'Coil stock', 'Materials and grades', 'Machines', 'Shifts', 'QR settings', 'Users and access', 'Other'];
const unit1Permissions = permissions => permissions.filter(item => item.key.startsWith('unit1.'))
  .map(item => ({ ...item, group: permissionGroup(item.key), label: item.label.replace(/\bUnit 1\s*/g, '') }))
  .sort((left, right) => groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group));

router.use(auth);

router.get('/', access([], 'unit1.users.view'), async (_req, res, next) => {
  try {
    const [users] = await db.query(`SELECT ${columns} FROM users ORDER BY FIELD(role,'superadmin','production_manager','plant_manager','admin','supervisor','labour'),name,id`);
    res.json({ data: users });
  } catch (error) { next(error); }
});

router.post('/', access([], 'unit1.users.manage'), async (req, res, next) => {
  try {
    const value = userFields(req.body);
    const password = String(req.body?.password || '');
    if (password.length < 8 || password.length > 128) throw fail(400, 'Password must contain 8 to 128 characters.');
    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.execute('INSERT INTO users (name,email,password,role,assigned_shift,status) VALUES (?,?,?,?,?,?)', [value.name, value.email, hash, value.role, value.assignedShift, 'active']);
    publishUnit1Change(req, 'users', { userId: result.insertId, action: 'created' });
    res.status(201).json({ data: await getUser(result.insertId) });
  } catch (error) { handleError(error, next); }
});

router.put('/:id', access([], 'unit1.users.manage'), async (req, res, next) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const user = await getUser(id);
    if (!user) throw fail(404, 'User not found.');
    if (user.role === 'superadmin') throw fail(403, 'Superadmin accounts cannot be edited here.');
    const value = userFields(req.body);
    await db.execute('UPDATE users SET name=?,email=?,role=?,assigned_shift=?,assigned_machine_id=IF(?="labour",assigned_machine_id,NULL) WHERE id=?', [value.name, value.email, value.role, value.assignedShift, value.role, id]);
    publishUnit1Change(req, 'users', { userId: id, action: 'updated' });
    res.json({ data: await getUser(id) });
  } catch (error) { handleError(error, next); }
});

router.put('/:id/machine-assignment', access([], 'unit1.users.labour.assign'), async (req, res, next) => {
  const id = idOf(req.params.id);
  const machineId = req.body?.machineId == null || req.body.machineId === '' ? null : idOf(req.body.machineId);
  if (!id || (req.body?.machineId != null && req.body.machineId !== '' && !machineId)) return res.status(400).json({ error: 'Select a valid user and machine.' });
  try {
    const user = await getUser(id);
    if (!user) throw fail(404, 'User not found.');
    if (user.role !== 'labour') throw fail(409, 'Only Labour users can be assigned to a machine.');
    if (machineId) {
      const [[machine]] = await db.execute('SELECT id,is_active AS isActive FROM unit1_machines WHERE id=?', [machineId]);
      if (!machine || !machine.isActive) throw fail(409, 'Select an active machine.');
    }
    await db.execute('UPDATE users SET assigned_machine_id=? WHERE id=? AND role="labour"', [machineId, id]);
    publishUnit1Change(req, 'users', { userId: id, action: 'machine_assigned' });
    res.json({ data: await getUser(id) });
  } catch (error) { next(error); }
});

router.patch('/:id/status', access([], 'unit1.users.manage'), async (req, res, next) => {
  const id = idOf(req.params.id);
  const status = String(req.body?.status || '');
  if (!id || !['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Select a valid user and status.' });
  try {
    const user = await getUser(id);
    if (!user) throw fail(404, 'User not found.');
    if (user.role === 'superadmin' || id === req.user.id) throw fail(403, 'This account cannot be deactivated here.');
    await db.execute('UPDATE users SET status=? WHERE id=?', [status, id]);
    publishUnit1Change(req, 'users', { userId: id, action: 'status_updated' });
    res.json({ data: await getUser(id) });
  } catch (error) { next(error); }
});

router.put('/:id/password', access([], 'unit1.users.manage'), async (req, res, next) => {
  const id = idOf(req.params.id);
  const password = String(req.body?.password || '');
  if (!id || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Enter a user and a password of 8 to 128 characters.' });
  try {
    const user = await getUser(id);
    if (!user) throw fail(404, 'User not found.');
    if (user.role === 'superadmin') throw fail(403, 'Superadmin passwords cannot be reset here.');
    await db.execute('UPDATE users SET password=? WHERE id=?', [await bcrypt.hash(password, 12), id]);
    publishUnit1Change(req, 'users', { userId: id, action: 'password_updated' });
    res.json({ data: { updated: true } });
  } catch (error) { next(error); }
});

router.get('/:id/permissions', access([], 'unit1.users.manage'), async (req, res, next) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const user = await getUser(id);
    if (!user) throw fail(404, 'User not found.');
    const accessInfo = await getUserAccess({ userId: id, role: user.role, queryable: db, scope: 'unit1' });
    res.json({ data: { user, permissions: unit1Permissions(accessInfo.permissions) } });
  } catch (error) { next(error); }
});

router.put('/:id/permissions', access([], 'unit1.users.manage'), async (req, res, next) => {
  const id = idOf(req.params.id);
  const overrides = req.body?.overrides;
  if (!id || !Array.isArray(overrides)) return res.status(400).json({ error: 'Valid permission overrides are required.' });
  const seen = new Set();
  for (const item of overrides) {
    if (typeof item?.key !== 'string' || !item.key.startsWith('unit1.') || !getPermissionDefinition(item.key) || seen.has(item.key) || ![true, false, null].includes(item.allowed)) return res.status(400).json({ error: 'Invalid or duplicate Unit 1 permission.' });
    seen.add(item.key);
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[user]] = await connection.execute('SELECT id,role FROM users WHERE id=? FOR UPDATE', [id]);
    if (!user) throw fail(404, 'User not found.');
    if (user.role === 'superadmin') throw fail(403, 'Superadmin access is always enabled.');
    for (const item of overrides) {
      if (item.allowed == null) await connection.execute('DELETE FROM user_permission_overrides WHERE user_id=? AND permission_key=?', [id, item.key]);
      else await connection.execute('INSERT INTO user_permission_overrides (user_id,permission_key,allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE allowed=VALUES(allowed)', [id, item.key, item.allowed ? 1 : 0]);
    }
    await connection.commit();
    publishUnit1Change(req, 'users', { userId: id, action: 'permissions_updated' });
    const accessInfo = await getUserAccess({ userId: id, role: user.role, queryable: db, scope: 'unit1' });
    res.json({ data: { permissions: unit1Permissions(accessInfo.permissions) } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

module.exports = router;
