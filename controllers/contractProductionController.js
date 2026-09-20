const db = require('../config/db');
const { DateTime } = require('luxon');

// This report attributes output only to the contractor saved on each entry.
// Legacy shift assignments must not assign otherwise unlinked production.
const getContractProduction = async (req, res) => {
  const year = req.financialYear;
  const month = req.query.month === undefined
    ? DateTime.now().setZone('Asia/Kolkata').month
    : Number(req.query.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ success: false, message: 'Select a month from January to December.' });
  }
  if (req.query.financial_year_id != null && Number(req.query.financial_year_id) !== Number(year.id)) {
    return res.status(409).json({ success: false, message: 'The financial year changed. Refresh and try again.' });
  }
  const calendarYear = Number(year.start_date.slice(0, 4)) + (month < 4 ? 1 : 0);
  const from = `${calendarYear}-${String(month).padStart(2, '0')}-01`;
  const to = DateTime.fromISO(from).endOf('month').toISODate();
  try {
    const [rows] = await db.query(`SELECT c.id AS contractor_id, c.name AS contractor_name,
      COUNT(pe.id) AS entry_count, COALESCE(SUM(pe.dipping_qty), 0) AS qty,
      COALESCE(SUM(COALESCE(pe.ms_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS ms_kg,
      COALESCE(SUM(COALESCE(pe.gi_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS gi_kg
      FROM contractors c LEFT JOIN production_entries pe ON pe.contractor_id = c.id
        AND pe.shift_date BETWEEN ? AND ? AND COALESCE(pe.row_type, 'entry') = 'entry'
      GROUP BY c.id, c.name ORDER BY c.name, c.id`, [from, to]);
    const summaries = rows.map(row => ({ ...row,
      entry_count: Number(row.entry_count), qty: Number(row.qty),
      ms_kg: Number(row.ms_kg), gi_kg: Number(row.gi_kg),
    }));
    const totals = summaries.reduce((total, row) => {
      for (const key of ['entry_count', 'qty', 'ms_kg', 'gi_kg']) total[key] += row[key];
      return total;
    }, { entry_count: 0, qty: 0, ms_kg: 0, gi_kg: 0 });
    return res.json({ success: true, data: {
      financial_year_id: year.id, financial_year: year.financial_year,
      month, from, to, summaries, totals,
    } });
  } catch (error) {
    console.error('Contract production report failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load contract production.' });
  }
};

module.exports = { getContractProduction };
