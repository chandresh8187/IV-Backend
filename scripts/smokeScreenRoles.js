// Opt-in GET-only API smoke check for each default role on the local server.
// Temporary admin and plant manager users are removed after the check.
require('dotenv').config();
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { DateTime } = require('luxon');
const db = require('../config/db');

const baseUrl = 'http://127.0.0.1:5000/api';
const today = DateTime.now().setZone('Asia/Kolkata');
const month = today.toFormat('yyyy-MM');
const date = today.toISODate();
const checks = [
  ['/auth/profile', null],
  ['/auth/access', null],
  ['/dashboard', 'dashboard.view'],
  ['/productions?limit=1&page=1', 'production.view'],
  ['/shifts/production-context', 'production.view'],
  ['/production-planning', 'planning.view'],
  ['/production-planning/available', 'production.view'],
  [`/production-history/dates?month=${month}`, 'history.view'],
  [`/production-history/party-summary?date=${date}`, 'history.view'],
  ['/labour-weights', 'labour_weights.view'],
  ['/labour-weights/mode', null],
  ['/gas-management', 'gas.view'],
  ['/zinc-stock', 'zinc_stock.view'],
  ['/zinc-stock/rate-calculator-context', 'rate_calculator.view'],
  [`/expense-report?month=${month}`, 'expense_report.view'],
  ['/chemical-checks', 'chemical_checks.view'],
  ['/contractors/directory', 'contractors.view'],
  ['/certificates', 'certificates.view'],
  ['/plant/status', 'plant.view'],
  ['/financial-years/current', null],
  ['/users', 'users.view'],
];

const main = async () => {
  assert.match(process.env.DB_HOST || '', /^(localhost|127\.0\.0\.1)$/i,
    'This check must use a local database');
  const createdIds = [];
  try {
    const [existing] = await db.query("SELECT id, role FROM users WHERE status='active' AND role IN ('superadmin','supervisor','labour')");
    const users = [...existing.filter((row, index, all) => all.findIndex(other => other.role === row.role) === index)];
    for (const role of ['admin', 'plant_manager']) {
      const password = await bcrypt.hash(`smoke-${Date.now()}-${Math.random()}`, 4);
      const [result] = await db.query(
        'INSERT INTO users (name, email, password, role, status, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [`Smoke ${role}`, `smoke-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@invalid.local`, password, role, 'active', 1],
      );
      createdIds.push(result.insertId);
      users.push({ id: result.insertId, role });
    }
    assert.equal(users.length, 5, 'Five default roles must be available');
    const failures = [];
    for (const user of users) {
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { issuer: 'iv-api', audience: 'iv-app' });
      const accessResponse = await fetch(`${baseUrl}/auth/access`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(accessResponse.status, 200, `${user.role} access`);
      const access = await accessResponse.json();
      const allowed = new Map(access.data.permissions.map(item => [item.key, item.allowed]));
      let passed = 0;
      for (const [path, permission] of checks) {
        const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        const expected = permission == null || allowed.get(permission);
        const okay = expected ? response.ok : response.status === 403;
        if (okay) passed += 1;
        else failures.push(`${user.role} ${path}: HTTP ${response.status}, expected ${expected ? '2xx' : '403'}`);
      }
      console.log(`${user.role}: ${passed}/${checks.length} screen APIs`);
    }
    if (failures.length) throw new Error(failures.join('\n'));
  } finally {
    for (const id of createdIds) await db.query('DELETE FROM users WHERE id = ?', [id]);
    await db.end();
  }
};

main().catch(error => { console.error(error.message); process.exitCode = 1; });
