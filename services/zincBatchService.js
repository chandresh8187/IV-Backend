// Reconstruct FIFO lots from the immutable ledger, including receipts before
// the selected reporting month. All arithmetic uses integer grams.
const toGrams = value => Math.round(Number(value || 0) * 1000);
function traceZincBatches(rows) {
  const lots = new Map(), entryUsage = new Map(), movements = [];
  let sequence = 0;
  const makeLot = (key, source, label) => {
    if (!lots.has(key)) lots.set(key, {
      key, receipt_id: source?.movement_type === 'receive' ? source.id : null,
      batch_number: source?.batch_number || null, invoice_number: source?.invoice_number || null,
      source_label: label, order: sequence++, plant: 0, kettle: 0,
    });
    return lots.get(key);
  };
  const balance = location => [...lots.values()].reduce((sum, lot) => sum + lot[location], 0);
  const allocate = (location, amount, fallbackKey, fallbackLabel) => {
    const pieces = [];
    let remaining = amount;
    for (const lot of lots.values()) {
      const used = Math.min(remaining, lot[location]);
      if (used > 0) {
        lot[location] -= used;
        pieces.push({ lot, grams: used });
        remaining -= used;
      }
      if (!remaining) break;
    }
    if (remaining) pieces.push({ lot: makeLot(fallbackKey, null, fallbackLabel), grams: remaining });
    return pieces;
  };
  const reconcile = (location, target, row) => {
    const delta = Math.max(0, toGrams(target)) - balance(location);
    if (delta > 0) {
      const label = row.movement_type === 'initialize' ? 'Opening stock (unreferenced)' : 'Stock correction (unreferenced)';
      makeLot(`unreferenced:${row.id}:${location}`, null, label)[location] += delta;
    } else if (delta < 0) allocate(location, -delta, `legacy:${row.id}`, 'Legacy stock (unreferenced)');
  };
  const serialize = pieces => {
    const grouped = new Map();
    for (const piece of pieces) {
      if (!grouped.has(piece.lot.key)) grouped.set(piece.lot.key, { ...piece.lot, grams: 0 });
      grouped.get(piece.lot.key).grams += piece.grams;
    }
    return [...grouped.values()].filter(item => item.grams !== 0).map(item => ({
      lot_key: item.key, receipt_id: item.receipt_id, batch_number: item.batch_number,
      invoice_number: item.invoice_number, source_label: item.source_label, amount_kg: item.grams / 1000,
    }));
  };
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
    const amount = Math.max(0, toGrams(row.amount_kg));
    let pieces = [];
    if (row.movement_type === 'receive') {
      const lot = makeLot(`receipt:${row.id}`, row, 'Zinc receipt');
      lot.plant += amount;
      pieces = [{ lot, grams: amount }];
    } else if (row.movement_type === 'transfer') {
      pieces = allocate('plant', amount, `legacy:${row.id}`, 'Legacy stock (unreferenced)');
      pieces.forEach(piece => { piece.lot.kettle += piece.grams; });
    } else if (row.movement_type === 'production_use') {
      pieces = allocate('kettle', amount, `legacy:${row.id}`, 'Legacy stock (unreferenced)');
      if (row.production_entry_id != null) {
        const key = String(row.production_entry_id), used = entryUsage.get(key) || [];
        used.push(...pieces.map(piece => ({ ...piece })));
        entryUsage.set(key, used);
      }
    } else if (row.movement_type === 'production_restore') {
      // Return edited/deleted production to its original receipt lots.
      const used = entryUsage.get(String(row.production_entry_id)) || [];
      let remaining = amount;
      while (remaining && used.length) {
        const piece = used[used.length - 1], restored = Math.min(remaining, piece.grams);
        piece.lot.kettle += restored;
        pieces.push({ lot: piece.lot, grams: -restored });
        piece.grams -= restored;
        remaining -= restored;
        if (!piece.grams) used.pop();
      }
      if (remaining) {
        const lot = makeLot(`legacy-return:${row.id}`, null, 'Legacy production return (unreferenced)');
        lot.kettle += remaining;
        pieces.push({ lot, grams: -remaining });
      }
    } else if (['initialize', 'adjust'].includes(row.movement_type)) {
      reconcile('plant', row.plant_after_kg, row);
      reconcile('kettle', row.kettle_after_kg, row);
    }
    movements.push({ ...row, batch_allocations: serialize(pieces) });
  }
  return {
    movements,
    batch_balances: [...lots.values()].filter(lot => lot.plant || lot.kettle).map(lot => ({
      lot_key: lot.key, receipt_id: lot.receipt_id, batch_number: lot.batch_number,
      invoice_number: lot.invoice_number, source_label: lot.source_label,
      plant_kg: lot.plant / 1000, kettle_kg: lot.kettle / 1000, remaining_kg: (lot.plant + lot.kettle) / 1000,
    })),
  };
}
module.exports = { traceZincBatches };
