const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function vendorInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!name || name.length > 150 || /[\x00-\x1f\x7f]/.test(name)) {
    throw fail('Enter a vendor name with at most 150 characters.');
  }
  if (!code || code.length > 100 || /[\x00-\x1f\x7f]/.test(code)) {
    throw fail('Enter a vendor code with at most 100 characters.');
  }
  return { name, code };
}

async function listVendors(db) {
  const [rows] = await db.execute('SELECT id,name,code FROM unit1_vendors ORDER BY name,code,id');
  return rows;
}

async function getVendor(db, id) {
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) {
    throw fail('Select a valid vendor.');
  }
  const [[vendor]] = await db.execute('SELECT id,name,code FROM unit1_vendors WHERE id=?', [Number(id)]);
  if (!vendor) throw fail('Vendor not found. Refresh the vendor list and select again.', 404);
  return vendor;
}

async function createVendor(connection, body, actorId) {
  const value = vendorInput(body);
  let inserted;
  try {
    [inserted] = await connection.execute(
      'INSERT INTO unit1_vendors(name,code,created_by) VALUES (?,?,?)',
      [value.name, value.code, actorId],
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw fail('This vendor code already exists.', 409);
    throw error;
  }
  // Link older invoices by their recorded code, preserving the original text.
  await connection.execute(
    `UPDATE unit1_coil_invoices SET vendor_id=?
     WHERE vendor_id IS NULL AND
       CONVERT(TRIM(vendor_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
       CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci`,
    [inserted.insertId, value.code],
  );
  return { id: inserted.insertId, ...value };
}

module.exports = { vendorInput, listVendors, getVendor, createVendor };
