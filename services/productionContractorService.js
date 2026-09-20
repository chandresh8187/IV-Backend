const validateContractor = async (connection, value) => {
  if (value == null) return null;
  const id = Number(value);
  if (!['number', 'string'].includes(typeof value) || !Number.isSafeInteger(id) || id <= 0) {
    throw Object.assign(new Error('Select a valid contractor'), { status: 400 });
  }
  const [rows] = await connection.query('SELECT id FROM contractors WHERE id = ? LOCK IN SHARE MODE', [id]);
  if (!rows.length) throw Object.assign(new Error('This contractor is no longer available. Refresh and select another contractor.'), { status: 409 });
  return id;
};
module.exports = { validateContractor };
