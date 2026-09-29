const db = require('../config/db');
const { publishOnce } = require('../utils/checkEntryZincNotification');

const ZINC_LIMIT_KG = 6000;
const GAS_LIMIT_BOTTLES = 4;

const readStockLevels = async () => {
  const [[zincRows], [gasRows]] = await Promise.all([
    db.query('SELECT initialized, plant_kg FROM zinc_stock WHERE id = 1'),
    db.query("SELECT COUNT(*) AS total, COALESCE(SUM(status IN ('filled', 'ready', 'running')), 0) AS filled FROM gas_bottles"),
  ]);
  return {
    zinc: zincRows[0] && Number(zincRows[0].initialized) ? Number(zincRows[0].plant_kg) : null,
    gas: Number(gasRows[0]?.total) ? Number(gasRows[0].filled) : null,
  };
};

const updateEpisode = async (stockType, isLow) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('INSERT IGNORE INTO stock_alert_state (stock_type) VALUES (?)', [stockType]);
    const [[state]] = await connection.query('SELECT is_low, generation FROM stock_alert_state WHERE stock_type = ? FOR UPDATE', [stockType]);
    let generation = Number(state.generation);
    if (isLow && !Number(state.is_low)) {
      generation += 1;
      await connection.query('UPDATE stock_alert_state SET is_low = 1, generation = ? WHERE stock_type = ?', [generation, stockType]);
    } else if (!isLow && Number(state.is_low)) {
      await connection.query('UPDATE stock_alert_state SET is_low = 0 WHERE stock_type = ?', [stockType]);
    }
    await connection.commit();
    return generation;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
};

const checkStockAlerts = async () => {
  const levels = await readStockLevels();
  const alerts = [
    { key: 'zinc', level: levels.zinc, limit: ZINC_LIMIT_KG, title: 'Low zinc stock' },
    { key: 'gas', level: levels.gas, limit: GAS_LIMIT_BOTTLES, title: 'Low gas stock' },
  ];
  for (const alert of alerts) {
    if (alert.level == null) continue;
    const low = alert.level <= alert.limit;
    const generation = await updateEpisode(alert.key, low);
    if (!low) continue;
    await publishOnce({
      type: `${alert.key}_stock_low`,
      referenceKey: `${alert.key}_stock_episode_${generation}`,
      title: alert.title,
      roles: ['superadmin', 'admin', 'plant_manager'],
      excludeRoles: ['supervisor'],
      body: alert.key === 'zinc'
        ? `Plant zinc stock is only ${alert.level.toLocaleString('en-IN')} kg (alert at ${ZINC_LIMIT_KG.toLocaleString('en-IN')} kg or less).`
        : `Gas stock is only ${alert.level} filled bottle${alert.level === 1 ? '' : 's'} (alert at ${GAS_LIMIT_BOTTLES} or fewer).`,
      data: { type: `${alert.key}_stock_low`, stock_type: alert.key, remaining: String(alert.level), threshold: String(alert.limit) },
    });
  }
  return levels;
};

module.exports = { ZINC_LIMIT_KG, GAS_LIMIT_BOTTLES, readStockLevels, checkStockAlerts };
