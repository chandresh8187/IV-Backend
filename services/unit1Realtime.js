function publishUnit1Change(req, resource, details = {}) {
  const room = req.app.get('io')?.to('unit1:production');
  if (!room) return;
  const event = { resource, ...details, at: new Date().toISOString() };
  room.emit('unit1:data:changed', event);
  if (['production', 'job-cards', 'machines', 'coils'].includes(resource)) {
    room.emit('unit1:production:changed', event);
  }
}

module.exports = { publishUnit1Change };
