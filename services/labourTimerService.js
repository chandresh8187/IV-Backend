const db = require('../config/db');

const DEFAULT_LIMIT_SECONDS = { pickling: 420, flux: 120, hot_drier: 300, zinc_kettle: 300 };
const PROCESSES = Object.keys(DEFAULT_LIMIT_SECONDS);

const timerColumns = process => ({
  started: `${process}_started_at`,
  client: `${process}_client_started_at_ms`,
  duration: `${process}_duration_seconds`,
  limit: `${process}_limit_seconds`,
});

const effectiveStartMs = (entry, process) => {
  const { started, client } = timerColumns(process);
  const serverMs = new Date(entry[started]).getTime();
  const clientMs = Number(entry[client]);
  return Number.isSafeInteger(clientMs) && clientMs > 0 && Math.abs(serverMs - clientMs) <= 10000 ? clientMs : serverMs;
};

const finishTimer = async (connection, entry, process, seconds) => {
  const { started, client, duration } = timerColumns(process);
  await connection.query(`UPDATE labour_weight_entries SET ${started} = NULL, ${client} = NULL, ${duration} = ? WHERE id = ?`, [seconds, entry.id]);
  await connection.query(`UPDATE production_entries p JOIN labour_weight_consumptions c ON c.production_entry_id = p.id SET p.${duration} = ? WHERE c.labour_weight_id = ?`, [seconds, entry.id]);
  if (entry.production_entry_id) await connection.query(`UPDATE production_entries SET ${duration} = ? WHERE id = ?`, [seconds, entry.production_entry_id]);
};

const expireDueTimers = async io => {
  const [candidates] = await db.query(`SELECT id FROM labour_weight_entries WHERE ${PROCESSES.map(process => `${process}_started_at IS NOT NULL`).join(' OR ')}`);
  for (const candidate of candidates) {
    const connection = await db.getConnection();
    let expired = false;
    try {
      await connection.beginTransaction();
      const [[entry]] = await connection.query('SELECT * FROM labour_weight_entries WHERE id = ? FOR UPDATE', [candidate.id]);
      if (entry) for (const process of PROCESSES) {
        const { started, limit } = timerColumns(process);
        if (!entry[started]) continue;
        const seconds = Number(entry[limit]) || DEFAULT_LIMIT_SECONDS[process];
        if (Date.now() - effectiveStartMs(entry, process) < seconds * 1000) continue;
        await finishTimer(connection, entry, process, seconds);
        expired = true;
      }
      await connection.commit();
      if (expired) {
        io?.emit('labour_weights_updated', { action: 'timer_auto_stopped', id: candidate.id });
        io?.emit('production_updated', { action: 'labour_timer_auto_stopped' });
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
};

module.exports = { DEFAULT_LIMIT_SECONDS, timerColumns, effectiveStartMs, finishTimer, expireDueTimers };
