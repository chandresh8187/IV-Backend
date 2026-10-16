const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { normalizeMachine } = require('../services/unit1MachineValidation');
const { publishUnit1Change } = require('../services/unit1Realtime');

const columns = 'id, code, name, description, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt';

router.use(auth);

router.get('/', access([], 'unit1.machines.view'), async (req, res, next) => {
  try {
    const activeOnly = String(req.query.active || '') === '1';
    const [rows] = await db.query(`SELECT ${columns} FROM unit1_machines ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY is_active DESC, name, id`);
    res.json({ data: rows.map(row => ({ ...row, isActive: Boolean(row.isActive) })) });
  } catch (error) { next(error); }
});

router.post('/', access([], 'unit1.machines.manage'), async (req, res, next) => {
  const result = normalizeMachine(req.body, { creating: true });
  if (result.error) return res.status(400).json({ error: result.error });
  const machine = result.value;
  try {
    const [insert] = await db.execute('INSERT INTO unit1_machines (code, name, description, is_active) VALUES (?, ?, ?, ?)', [machine.code, machine.name, machine.description, machine.isActive]);
    const [rows] = await db.execute(`SELECT ${columns} FROM unit1_machines WHERE id = ?`, [insert.insertId]);
    publishUnit1Change(req, 'machines', { machineId: insert.insertId, action: 'created' });
    res.status(201).json({ data: { ...rows[0], isActive: Boolean(rows[0].isActive) } });
  } catch (error) { next(error); }
});

router.put('/:id', access([], 'unit1.machines.manage'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid machine ID.' });
  const result = normalizeMachine(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const machine = result.value;
  const connection = await db.getConnection().catch(next);
  if (!connection) return;
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id FROM unit1_machines WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!existing.length) { await connection.rollback(); return res.status(404).json({ error: 'Machine not found.' }); }
    if (machine.isActive === false) {
      const [runs] = await connection.execute("SELECT id FROM unit1_production_runs WHERE machine_id = ? AND status IN ('setup','running','paused') LIMIT 1", [req.params.id]);
      if (runs.length) { await connection.rollback(); return res.status(409).json({ error: 'Complete the open production run before deactivating this machine.' }); }
    }
    await connection.execute(
      'UPDATE unit1_machines SET name = ?, description = ?, is_active = COALESCE(?, is_active) WHERE id = ?',
      [machine.name, machine.description, machine.isActive ?? null, req.params.id],
    );
    await connection.commit();
    const [rows] = await db.execute(`SELECT ${columns} FROM unit1_machines WHERE id = ?`, [req.params.id]);
    publishUnit1Change(req, 'machines', { machineId: Number(req.params.id), action: 'updated' });
    res.json({ data: { ...rows[0], isActive: Boolean(rows[0].isActive) } });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

router.use((error, _req, res, next) => {
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Machine code already exists.' });
  if (['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) return res.status(503).json({ error: 'Unit 1 machine database unavailable or schema needs migration.' });
  next(error);
});

module.exports = router;
