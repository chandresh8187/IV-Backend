function parseCenterOffset(value) {
  const text = String(value).trim();
  const offset = Number(text);
  if (!/^[+-]?\d+(?:\.\d{1,3})?$/.test(text) || Math.abs(offset) > 2500) {
    throw Object.assign(new Error('Enter a signed WEB centre offset within ±2500 mm (up to three decimals).'), { status: 400 });
  }
  return offset;
}

module.exports = { parseCenterOffset };
