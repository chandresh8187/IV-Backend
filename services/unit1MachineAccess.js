// Fixed machine responsibilities take precedence over per-user feature overrides.
const managementKeys = new Set([
  'unit1.jobcards.assign', 'unit1.jobcards.unassign',
  'unit1.production.coil.assign', 'unit1.production.coil.remove',
  'unit1.production.operate',
]);

function machineRoleAccess(role, key) {
  const manager = role === 'superadmin' || role === 'plant_manager';
  if (key === 'unit1.production.coil.assign') return manager || role === 'supervisor' || (role !== 'labour' ? undefined : false);
  if (key === 'unit1.production.supervise') return manager || role === 'supervisor';
  if (key === 'unit1.production.bundle') return manager || role === 'supervisor';
  if (managementKeys.has(key)) {
    if (manager) return true;
    if (role === 'supervisor' || role === 'labour') return false;
  }
  if (manager && key === 'unit1.coils.view') return true;
  return undefined;
}

module.exports = { machineRoleAccess };
