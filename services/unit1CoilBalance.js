// The full strip weight already includes punched scrap; do not subtract it twice.
async function coilBalance(connection, coilId, coilNumber) {
  const [[row]] = await connection.execute(`SELECT c.actual_net_kg / c.coil_qty AS startingKg,
    (SELECT COALESCE(SUM(b.theoretical_used_kg),0)
     FROM unit1_production_runs r JOIN unit1_production_bundles b ON b.run_id=r.id
     WHERE r.coil_id=c.id AND r.coil_number=?) AS usedKg
    FROM coils c WHERE c.id=?`, [coilNumber, coilId]);
  if (!row) throw Object.assign(new Error('Coil not found.'), { status: 404 });
  const startingKg = Number(row.startingKg);
  const usedKg = Number(row.usedKg);
  return { startingKg, usedKg, remainingKg: startingKg - usedKg };
}

module.exports = { coilBalance };
