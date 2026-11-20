const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateInvoice, createInvoice } = require('../services/unit1CoilInvoices');

const input = () => ({
  vendorCode: 'TC-TEST', invoice: 'TC-INVOICE', requestId: 'tc_invoice_' + Date.now(),
  lines: [
    { materialType: 'MS', grade: 'E350', widthMm: 298, thicknessMm: 2, coilQty: 3, totalWeightKg: 6000, ratePerKg: 60, tcNumber: 'TC-1' },
    { materialType: 'MS', grade: 'E350', widthMm: 298, thicknessMm: 2, coilQty: 2, totalWeightKg: 4000, ratePerKg: 65, tcNumber: 'TC-2' },
  ],
});

test('each coil line has a required TC and mixed TCs do not become one invoice TC', () => {
  const body = input();
  const result = validateInvoice(body);
  assert.deepEqual(result.lines.map(line => [line.tcNumber, line.coilQty, line.totalWeightKg]), [['TC-1', 3, 6000], ['TC-2', 2, 4000]]);
  assert.equal(result.tcNumber, '');
  for (const tcNumber of [undefined, '', '   ', 'A'.repeat(101), 'TC\n1']) {
    assert.throws(() => validateInvoice({ ...body, lines: [{ ...body.lines[0], tcNumber }] }), /TC number|TC number.*characters/);
  }
  assert.equal(validateInvoice({ ...body, lines: [{ ...body.lines[0], tcNumber: ' TC-1 ' }] }).lines[0].tcNumber, 'TC-1');
});

test('local TC lots create distinct shared QRs and assignment uses only the scanned TC stock', {
  skip: process.env.UNIT1_PHYSICAL_COIL_DB_TEST !== '1',
}, async () => {
  require('dotenv-flow').config({ silent: true });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.UNIT1_DB_HOST || process.env.DB_HOST));
  const db = require('../config/unit1Db');
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [[actor]] = await c.execute('SELECT id FROM users LIMIT 1');
    const body = input();
    const { addStock, listInvoices, listStock } = require('../services/unit1StockRegister');
    const saved = await addStock(c, body, actor.id);
    assert.deepEqual(saved.lines.map(line => [line.tcNumber, line.coilQty, line.totalWeightKg]), [['TC-1', 3, 6000], ['TC-2', 2, 4000]]);
    assert.ok(saved.lines.every(line => /^CQ\d{8}$/.test(line.qrCode)));
    assert.equal(new Set(saved.lines.map(line => line.qrCode)).size, 2);
    assert.equal((await addStock(c, body, actor.id)).id, saved.id);
    await assert.rejects(addStock(c, { ...body, lines: [body.lines[0], { ...body.lines[1], tcNumber: 'TC-3' }] }, actor.id), { status: 409 });
    const spec = body.lines[0];
    const invoices = (await listInvoices(c, spec)).filter(line => Number(line.invoiceGroupId) === Number(saved.id));
    assert.deepEqual(invoices.map(line => line.tcNumber).sort(), ['TC-1', 'TC-2']);
    const positions = await require('../services/unit1CoilStock').stockPositions(c, saved.lines.map(line => line.id));
    assert.equal(positions.reduce((sum, position) => sum + position.remainingKg, 0), 10000);
    const stock = (await listStock(c)).filter(row => row.widthMm === 298 && row.thicknessMm === 2 && row.materialType === 'MS' && row.grade === 'E350');
    assert.equal(stock.length, 1);
    const { invoiceQr, selectInward } = require('../services/unit1StockQr');
    const qrs = await Promise.all(saved.lines.map(line => invoiceQr(c, line.id, actor.id)));
    assert.deepEqual(qrs.map(qr => qr.code), saved.lines.map(line => line.qrCode));
    assert.deepEqual(qrs.map(qr => qr.tcNumber), ['TC-1', 'TC-2']);
    const [job] = await c.execute(
      "INSERT INTO unit1_job_cards(job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by,allowed_coil_sizes) VALUES ('2026-11-19','TC test','',100,'solar_mounting_structure','Test','100x50','day',1000,'MS',298,2,'12',?,?)",
      [actor.id, JSON.stringify([{ widthMm: 298, thicknessMm: 2 }])],
    );
    for (const [index, qr] of qrs.entries()) {
      const selected = await selectInward(c, qr.id, job.insertId, null);
      assert.equal(selected.coilId, saved.lines[index].id);
      assert.equal(selected.ratePerKg, body.lines[index].ratePerKg);
      await assert.rejects(selectInward(c, qr.id, job.insertId, saved.lines[1 - index].id), /another invoice/);
    }
    const fs = require('node:fs');
    const vm = require('node:vm');
    const routePath = require('node:path').join(__dirname, '../routes/unit1CoilRoutes.js');
    const localRequire = require('node:module').createRequire(routePath);
    const handlers = {};
    const router = { use() {}, get: (path, ...handlersForPath) => { handlers[path] = handlersForPath.at(-1); }, post() {}, put() {}, delete() {} };
    vm.runInNewContext(fs.readFileSync(routePath, 'utf8'), {
      module: { exports: {} },
      require: name => name === 'express' ? { Router: () => router } : name === '../config/unit1Db' ? c
        : ['../middleware/unit1AuthMiddleware', '../middleware/roleMiddleware'].includes(name) ? () => () => {} : localRequire(name),
    });
    for (const fields of [['tcNumber'], ['grade']]) {
      await c.execute("INSERT INTO unit1_qr_scan_role_fields(role,fields_json) VALUES ('labour',?) ON DUPLICATE KEY UPDATE fields_json=VALUES(fields_json)", [JSON.stringify(fields)]);
      let response, problem;
      await handlers['/lookup/:internalId'](
        { params: { internalId: qrs[0].code }, user: { role: 'labour' } },
        { json: value => { response = value; }, status() { return this; } },
        error => { problem = error; },
      );
      if (problem) throw problem;
      assert.deepEqual(Array.from(response.data.fields, field => field.key), fields);
      if (fields[0] === 'tcNumber') assert.equal(response.data.fields[0].value, 'TC-1');
      assert.equal(response.data.ratePerKg, undefined);
      assert.equal(response.data.vendorCode, undefined);
    }
    const bad = { ...body, requestId: body.requestId + '_missing', lines: [{ ...body.lines[0], tcNumber: '' }] };
    await assert.rejects(addStock(c, bad, actor.id), /TC number/);
    const [[missing]] = await c.execute('SELECT COUNT(*) n FROM unit1_coil_invoices WHERE request_key=?', [bad.requestId]);
    assert.equal(missing.n, 0);

    // A retry of an invoice saved before TC became mandatory remains a read.
    const legacy = { ...body, requestId: body.requestId + '_legacy', lines: [{ ...body.lines[0], tcNumber: '' }] };
    const value = validateInvoice(legacy, { requireTc: false });
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const [old] = await c.execute(
      'INSERT INTO unit1_coil_invoices(vendor_code,invoice,total_weight_kg,request_key,request_hash,actor_user_id) VALUES (?,?,?,?,?,?)',
      [value.vendorCode, value.invoice, value.totalWeightKg, value.requestId, hash, actor.id],
    );
    const coilId = await require('../services/unit1CoilQrGenerator').createQrRecord(c, { ...value.lines[0], requestId: legacy.requestId + '_line' });
    await c.execute('UPDATE coils SET invoice_group_id=? WHERE id=?', [old.insertId, coilId]);
    const retried = await createInvoice(c, legacy, actor.id);
    assert.equal(retried.id, old.insertId);
    assert.equal(retried.lines[0].tcNumber, null);
  } finally {
    await c.rollback();
    c.release();
    await db.end();
  }
});
