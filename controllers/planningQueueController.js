const db = require('../config/db');

const validIds = value => Array.isArray(value) && value.length > 0 &&
  value.every(id => Number.isSafeInteger(id) && id > 0) && new Set(value).size === value.length;

const reorderPlanningQueue = async (req, res) => {
  const { ordered_ids: order, expected_ids: expected } = req.body || {};
  if (!validIds(order) || !validIds(expected) || order.length !== expected.length || order.some(id => !expected.includes(id))) {
    return res.status(400).json({ success: false, message: 'Send the complete pending flow order with unique planning IDs.' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    // Production saves lock this same row before selecting their next item.
    await connection.query('SELECT id FROM production_shift_context WHERE id = 1 FOR UPDATE');
    const [rows] = await connection.query(`SELECT id FROM production_planning
      WHERE deleted_at IS NULL AND status = 'pending'
      ORDER BY COALESCE(queue_position, id) ASC, id ASC FOR UPDATE`);
    if (rows.length !== expected.length || rows.some((row, index) => Number(row.id) !== expected[index])) {
      await connection.rollback();
      return res.status(409).json({ success: false, code: 'PLANNING_QUEUE_CHANGED', message: 'The production queue changed. Refresh and drag the flow again.' });
    }
    for (let index = 0; index < order.length; index += 1) {
      await connection.query('UPDATE production_planning SET queue_position = ? WHERE id = ?', [index + 1, order[index]]);
    }
    await connection.commit();
    req.app.get('io')?.emit('production_planning_updated', { action: 'queue_reordered', planning_ids: order });
    return res.json({ success: true, message: 'Production flow priority updated', data: { ordered_ids: order } });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('reorderPlanningQueue:', error);
    return res.status(500).json({ success: false, message: 'Could not update production priority. Refresh and try again.' });
  } finally {
    connection?.release();
  }
};
module.exports = { reorderPlanningQueue };
