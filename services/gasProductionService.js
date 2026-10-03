// A shift_date is the operational date. For a shift that crosses midnight,
const { DateTime } = require('luxon');
const asMillis = value => value instanceof Date
  ? value.getTime()
  : DateTime.fromSQL(String(value).replace('T', ' ').slice(0, 19), { zone: 'Asia/Kolkata' }).toMillis();

const getRunTimeBreakdown = async (queryable, runs) => {
  if (!runs.length) return new Map();
  const starts = runs.map(run => asMillis(run.started_at)).filter(Number.isFinite);
  if (!starts.length) return new Map();
  const now = Date.now();
  const first = DateTime.fromMillis(Math.min(...starts), { zone: 'Asia/Kolkata' }).toFormat('yyyy-MM-dd HH:mm:ss');
  const current = DateTime.fromMillis(now, { zone: 'Asia/Kolkata' }).toFormat('yyyy-MM-dd HH:mm:ss');
  const [pauses] = await queryable.query("SELECT started_at, ended_at FROM plant_status_history WHERE status IN ('stopped', 'maintenance') AND started_at < ? AND COALESCE(ended_at, ?) > ? ORDER BY started_at", [current, current, first]);
  return new Map(runs.map(run => {
    const start = asMillis(run.started_at);
    const end = run.finished_at ? asMillis(run.finished_at) : now;
    const elapsed = Math.max(0, Math.floor((end - start) / 1000));
    const stopped = (pauses || []).reduce((total, pause) => {
      const pauseStart = asMillis(pause.started_at);
      const pauseEnd = pause.ended_at ? asMillis(pause.ended_at) : now;
      return total + Math.max(0, Math.min(end, pauseEnd) - Math.max(start, pauseStart));
    }, 0);
    const stoppedSeconds = Math.min(elapsed, Math.floor(stopped / 1000));
    return [Number(run.id), { elapsed_seconds: elapsed, stopped_seconds: stoppedSeconds, production_active_seconds: elapsed - stoppedSeconds }];
  }));
};

// A shift_date is the operational date. For a shift that crosses midnight,
// early-morning production_time values belong to the following calendar day.
const productionAtSql = `TIMESTAMP(pe.shift_date, CAST(pe.production_time AS TIME))
  + INTERVAL IF(s.start_time IS NOT NULL AND CAST(pe.production_time AS TIME) < TIME(s.start_time), 1, 0) DAY`;

const productionTonSql = `SELECT ROUND(COALESCE(SUM(pe.ms_weight * pe.dipping_qty), 0) / 1000, 3) production_ton
  FROM production_entries pe
  LEFT JOIN shifts s ON s.id = pe.shift_id
  WHERE ${productionAtSql} >= ? AND ${productionAtSql} < ?
    AND COALESCE(pe.row_type, 'entry') = 'entry'`;

const getProductionTonsForPeriod = async (queryable, startedAt, finishedAt) => {
  const [rows] = await queryable.query(productionTonSql, [startedAt, finishedAt]);
  return Number(rows[0]?.production_ton || 0);
};

const getProductionTonsForRuns = async (queryable, runs) => {
  const finishedRuns = runs.filter(run => run.finished_at);
  if (!finishedRuns.length) return new Map();
  const [rows] = await queryable.query(
    `SELECT gr.id, ROUND(COALESCE(SUM(production.ms_weight * production.dipping_qty), 0) / 1000, 3) production_ton
     FROM gas_bottle_runs gr
     LEFT JOIN (
       SELECT pe.ms_weight, pe.dipping_qty, ${productionAtSql} AS produced_at
       FROM production_entries pe
       LEFT JOIN shifts s ON s.id = pe.shift_id
       WHERE COALESCE(pe.row_type, 'entry') = 'entry'
     ) production ON production.produced_at >= gr.started_at
       AND production.produced_at < gr.finished_at
     WHERE gr.id IN (?)
     GROUP BY gr.id`,
    [finishedRuns.map(run => run.id)],
  );
  return new Map(rows.map(row => [Number(row.id), Number(row.production_ton || 0)]));
};

module.exports = { productionAtSql, getProductionTonsForPeriod, getProductionTonsForRuns, getRunTimeBreakdown };
