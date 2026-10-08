const MATERIALS = [
  { key: 'MS', label: 'MS', mode: 'select' },
  { key: 'GL', label: 'AZ150 - GL', mode: 'select' },
  { key: 'GP', label: 'GP (Pre GI)', mode: 'number', min: 80, max: 140 },
  { key: 'Posmac', label: 'Posmac', mode: 'select' },
];

function normalizeGrade(materialType, rawGrade) {
  if (!MATERIALS.some(item => item.key === materialType)) return { error: 'Select a valid material type.' };
  const grade = String(rawGrade ?? '').trim();
  if (!grade) return { error: 'Grade is required.' };
  if (materialType === 'GP') return { error: 'GP uses a GSM number from 80 to 140; grades are not managed as a list.' };
  if (grade.length > 100) return { error: 'Grade must be 100 characters or fewer.' };
  return { value: grade };
}

module.exports = { MATERIALS, normalizeGrade };
