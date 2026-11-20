async function deleteCoil(connection, id, actorId) {
  const [[coil]] = await connection.execute('SELECT * FROM coils WHERE id = ? FOR UPDATE', [id]);
  if (!coil) throw Object.assign(new Error('Coil inward not found.'), { status: 404 });
  if(coil.invoice_group_id)throw Object.assign(new Error('This is a line of a shared-weight invoice. Keep its invoice history; use the stock card deletion option instead.'),{status:409});
  const [[usage]] = await connection.execute("SELECT COUNT(*) AS usedQty, COALESCE(SUM(produced_pieces),0) AS producedPieces, COALESCE(SUM(status IN ('setup','running','paused')),0) AS activeAssignments FROM unit1_production_runs WHERE coil_id = ?", [id]);
  if (Number(usage.usedQty)) {
    const reason = Number(usage.producedPieces) > 0
      ? 'This inward has recorded production. Deleting it would break coil usage, stock and dispatch history.'
      : Number(usage.activeAssignments) > 0
        ? 'This inward has an assigned coil. Remove its setup assignment, or return/complete its running assignment, before deleting. Existing production history will still be protected.'
        : 'This inward has previous coil assignment history and cannot be permanently deleted.';
    throw Object.assign(new Error(reason), { status: 409 });
  }
  const [planned] = await connection.execute('SELECT job_card_id FROM unit1_job_card_coils WHERE coil_id=? FOR UPDATE', [id]);
  if (planned.length) throw Object.assign(new Error('This coil is selected in production planning. Remove that selection before deleting the inward.'), { status: 409 });
  const [identifiers] = await connection.execute('SELECT * FROM unit1_coil_identifiers WHERE batch_id=?', [id]);
  await connection.execute('INSERT INTO unit1_coil_revisions (coil_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)', [id,actorId,JSON.stringify({ coil, identifiers }),JSON.stringify({ deleted:true })]);
  // Keep identifier reservations and revision history after the inward is removed.
  await connection.execute('DELETE FROM coils WHERE id = ?', [id]);
}
module.exports = { deleteCoil };
