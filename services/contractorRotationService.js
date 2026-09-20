const monthIndex = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

// Calendar months, not elapsed 30-day periods. A Night shift belongs to its
// starting production date even when it ends in the next calendar month.
const resolveRotation = (rotations, shift, date, legacy) => {
  const rule = rotations.filter(item => item.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  if (!rule || (legacy?.effective_from && legacy.effective_from > rule.effective_from)) return legacy;
  const swap = Number(rule.rotate_monthly) === 1 && (monthIndex(date) - monthIndex(rule.effective_from)) % 2 === 1;
  const slot = swap ? (shift === 'day' ? 'night' : 'day') : shift;
  return { contractor_id: rule[`${slot}_contractor_id`], contractor_name: rule[`${slot}_contractor_name`],
    effective_from: rule.effective_from, rotate_monthly: Number(rule.rotate_monthly) === 1 };
};

module.exports = { resolveRotation };
