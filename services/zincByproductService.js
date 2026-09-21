const roundMoney = value => Math.round(Number(value) * 100) / 100;
const roundKg = value => Math.round(Number(value) * 1000) / 1000;

const number = (value, label, allowZero = false) => {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw Object.assign(new Error(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`), { status: 400 });
  }
  return parsed;
};

const calculateByproductRecovery = ({ ash_weight_kg, ash_rate, dross_weight_kg, dross_rate, zinc_rate }) => {
  const ashWeight = number(ash_weight_kg ?? 0, 'Ash weight', true);
  const drossWeight = number(dross_weight_kg ?? 0, 'Dross weight', true);
  if (ashWeight === 0 && drossWeight === 0) {
    throw Object.assign(new Error('Enter an ash or dross weight.'), { status: 400 });
  }
  const ashSellRate = number(ash_rate ?? 0, 'Ash sell rate', ashWeight === 0);
  const drossSellRate = number(dross_rate ?? 0, 'Dross sell rate', drossWeight === 0);
  const currentZincRate = number(zinc_rate, 'Current zinc rate');
  const ashBase = roundMoney(ashWeight * ashSellRate);
  const drossBase = roundMoney(drossWeight * drossSellRate);
  const ashGst = roundMoney(ashBase * 0.18);
  const drossGst = roundMoney(drossBase * 0.18);
  const total = roundMoney(ashBase + ashGst + drossBase + drossGst);
  return {
    ash_weight_kg: roundKg(ashWeight), ash_rate: roundMoney(ashSellRate),
    ash_base_amount: ashBase, ash_gst_amount: ashGst,
    dross_weight_kg: roundKg(drossWeight), dross_rate: roundMoney(drossSellRate),
    dross_base_amount: drossBase, dross_gst_amount: drossGst,
    total_with_gst: total, zinc_rate_snapshot: roundMoney(currentZincRate),
    recovered_zinc_kg: roundKg(total / currentZincRate),
  };
};

module.exports = { calculateByproductRecovery, roundMoney, roundKg };
