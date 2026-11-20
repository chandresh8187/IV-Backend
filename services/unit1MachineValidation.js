function normalizeMachine(body, { creating = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Machine details are required.' };
  const code = String(body.code ?? '').trim().toUpperCase();
  const name = String(body.name ?? '').trim();
  const description = String(body.description ?? '').trim();
  if (creating && !/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(code)) return { error: 'Machine code must be 2–30 letters, numbers, or hyphens.' };
  if (!name || name.length > 100) return { error: 'Machine name is required and must be 100 characters or fewer.' };
  if (description.length > 255) return { error: 'Description must be 255 characters or fewer.' };
  if (typeof body.isActive !== 'undefined' && typeof body.isActive !== 'boolean') return { error: 'Active status must be true or false.' };
  const hasBladeSize = Object.hasOwn(body, 'cutBladeSizeMm');
  const rawBladeSize = body.cutBladeSizeMm;
  const bladeSize = typeof rawBladeSize === 'string' ? rawBladeSize.trim() : rawBladeSize;
  const cutBladeSizeMm = bladeSize == null || bladeSize === '' ? null : Number(bladeSize);
  if (cutBladeSizeMm !== null && (
    !['string', 'number'].includes(typeof bladeSize) ||
    !/^\d+(?:\.\d{1,3})?$/.test(String(bladeSize)) || cutBladeSizeMm >= 1000000
  )) return { error: 'Enter a non-negative cut blade size in mm with up to three decimal places.' };
  return { value: { ...(creating ? { code } : {}), name, description: description || null, isActive: body.isActive ?? (creating ? true : undefined), ...(hasBladeSize ? { cutBladeSizeMm } : {}) } };
}

module.exports = { normalizeMachine };
