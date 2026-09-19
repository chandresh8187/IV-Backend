const error = message => Object.assign(new Error(message), { status: 400, code: 'INVALID_CHALLAN_NUMBER' });
function normalizePlanningChallan(item) {
  const source = item.planning_source || 'in_house';
  if (!['in_house', 'other_party'].includes(source)) throw error('Select In-house or Other party.');
  const number = String(item.challan_number ?? '').trim();
  if (!number || number.length > (source === 'in_house' ? 40 : 100) || /[\x00-\x1f\x7f]/.test(number)) {
    throw error(source === 'in_house' ? 'Enter an in-house challan reference (1–40 characters; letters, numbers and symbols allowed).' : 'Enter an other-party challan number (1–100 characters).');
  }
  return { planning_source: source, challan_number: number };
}
const formatPlanningChallan = (item, year) => item.planning_source === 'other_party' ? item.challan_number : `DC/${year}/${item.challan_number}`;
module.exports = { normalizePlanningChallan, formatPlanningChallan };
