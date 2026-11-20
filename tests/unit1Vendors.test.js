const test = require('node:test');
const assert = require('node:assert/strict');
const { vendorInput, getVendor, createVendor } = require('../services/unit1Vendors');

test('vendor name and unique code are validated and normalized', () => {
  assert.deepEqual(vendorInput({ name: '  Example Steel  ', code: ' v-01 ' }), { name: 'Example Steel', code: 'V-01' });
  for (const body of [{ name: '', code: 'A' }, { name: 'A', code: '' }, { name: 'A'.repeat(151), code: 'A' }, { name: 'A', code: 'B'.repeat(101) }, { name: 'A\nB', code: 'A' }]) {
    assert.throws(() => vendorInput(body), { status: 400 });
  }
});

test('vendor selection rejects invalid and missing IDs', async () => {
  const db = { execute: async () => [[]] };
  for (const id of ['', 0, -1, '1 OR 1=1', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(getVendor(db, id), { status: 400 });
  }
  await assert.rejects(getVendor(db, 1), { status: 404 });
});

test('local inward saves selected vendor, links prior invoices and keeps receipt retries idempotent', {
  skip: process.env.UNIT1_PHYSICAL_COIL_DB_TEST !== '1',
}, async () => {
  require('dotenv-flow').config({ silent: true });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.UNIT1_DB_HOST || process.env.DB_HOST));
  const db = require('../config/unit1Db');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[actor]] = await connection.execute('SELECT id FROM users LIMIT 1');
    const { addStock } = require('../services/unit1StockRegister');
    const code = 'VENDOR-TEST-' + Date.now();
    const body = {
      vendorCode: code.toLowerCase(), invoice: 'TEST-VENDOR-INVOICE', requestId: 'vendor_inward_' + Date.now(),
      lines: [{ tcNumber: 'TC-1', materialType: 'MS', grade: 'E350', widthMm: 298, thicknessMm: 2, coilQty: 2, totalWeightKg: 7000, ratePerKg: 60 }],
    };
    const legacy = await addStock(connection, body, actor.id);
    assert.equal(legacy.vendorId, null);
    const vendor = await createVendor(connection, { name: 'Vendor transaction test', code }, actor.id);
    const [[linked]] = await connection.execute('SELECT vendor_id vendorId,vendor_code vendorCode FROM unit1_coil_invoices WHERE id=?', [legacy.id]);
    assert.equal(Number(linked.vendorId), Number(vendor.id));
    assert.equal(linked.vendorCode, body.vendorCode);
    await assert.rejects(createVendor(connection, { name: 'Duplicate', code: code.toLowerCase() }, actor.id), { status: 409 });
    const selected = { ...body, vendorId: vendor.id, vendorCode: 'WRONG-CODE', requestId: body.requestId + '_selected' };
    const receipt = await addStock(connection, selected, actor.id);
    assert.equal(Number(receipt.vendorId), Number(vendor.id));
    assert.equal(receipt.vendorName, vendor.name);
    assert.equal(receipt.vendorCode, code);
    assert.equal((await addStock(connection, selected, actor.id)).id, receipt.id);
    const [[coil]] = await connection.execute('SELECT vendor_code vendorCode,actual_net_kg totalWeightKg,coil_qty coilQty FROM coils WHERE invoice_group_id=?', [receipt.id]);
    assert.equal(coil.vendorCode, code);
    assert.equal(Number(coil.totalWeightKg), 7000);
    assert.equal(coil.coilQty, 2);
    await assert.rejects(addStock(connection, { ...body, vendorId: 999999999 }, actor.id), { status: 404 });
  } finally {
    await connection.rollback();
    connection.release();
    await db.end();
  }
});
