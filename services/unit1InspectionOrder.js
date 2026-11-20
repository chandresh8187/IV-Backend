const { DateTime } = require('luxon');

function inspectionTime(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '');
  const date = text.includes('T')
    ? DateTime.fromISO(text, { zone: 'Asia/Kolkata' })
    : DateTime.fromSQL(text, { zone: 'Asia/Kolkata' });
  return date.isValid ? date.toMillis() : 0;
}

function newestInspectionsFirst(checks) {
  return [...checks].sort((a, b) => inspectionTime(b.checkedAt) - inspectionTime(a.checkedAt) || Number(b.id) - Number(a.id));
}

module.exports = { newestInspectionsFirst };
