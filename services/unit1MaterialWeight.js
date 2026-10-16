// Steel is the core of MS, GL, GP and PosMAC sheet. Coating mass varies by product.
const DEFAULT_DENSITY = 7.85; // g/cm³
const MATERIAL_TYPES = ['MS', 'GL', 'GP', 'Posmac'];

function theoreticalWeightKg({ widthMm, thicknessMm, lengthMm, pieces = 1, densityGcm3 = DEFAULT_DENSITY }) {
  const values = [widthMm, thicknessMm, lengthMm, pieces, densityGcm3].map(Number);
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  return values[0] * values[1] * values[2] * values[3] * values[4] / 1_000_000;
}

function roundKg(value) { return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000; }

function punchAreaMm2(rawSize) {
  const size = String(rawSize ?? '').trim().replace(/\s*mm\s*$/i, '').trim();
  const slot = size.match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i);
  if (slot) {
    const width = Math.min(Number(slot[1]), Number(slot[2]));
    const length = Math.max(Number(slot[1]), Number(slot[2]));
    return width > 0 ? width * (length - width) + Math.PI * (width / 2) ** 2 : null;
  }
  const round = size.match(/^(?:[Ø⌀]\s*)?(\d+(?:\.\d+)?)$/i);
  if (round) {
    const diameter = Number(round[1]);
    return diameter > 0 ? Math.PI * (diameter / 2) ** 2 : null;
  }
  return null;
}

function holeScrapKg({ holes, thicknessMm, pieces = 1, densityGcm3 = DEFAULT_DENSITY }) {
  if (!Array.isArray(holes) || !holes.length) return null;
  const values = [thicknessMm, pieces, densityGcm3].map(Number);
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  let areaMm2 = 0;
  for (const hole of holes) {
    const area = punchAreaMm2(hole?.punchSize);
    if (area === null) return null;
    areaMm2 += area;
  }
  return areaMm2 * values[0] * values[1] * values[2] / 1_000_000;
}

module.exports = { DEFAULT_DENSITY, MATERIAL_TYPES, theoreticalWeightKg, punchAreaMm2, holeScrapKg, roundKg };
