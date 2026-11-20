const { historicalJobSql } = require('./unit1JobHistory');
const { physicalCoilCodeSql } = require('./unit1PhysicalCoils');
const { reportDateRange } = require('./unit1HoleReports');
const { positiveId } = require('./unit1ProductionValidation');
const { historySummary } = require('./unit1HistorySummary');

async function productionReport(db, query) {
  const { date } = reportDateRange(query.date);
  const shift = String(query.shift || 'all');
  const machineId = query.machineId ? positiveId(query.machineId) : null;
  if (!['all', 'day', 'night'].includes(shift) || (query.machineId && !machineId)) throw Object.assign(new Error('Invalid production report filters.'), { status: 400 });
  const where = ['COALESCE(b.shift_date,DATE(b.created_at))=?'], params = [date];
  if (shift !== 'all') { where.push('COALESCE(b.shift,j.shift)=?'); params.push(shift); }
  if (machineId) { where.push('r.machine_id=?'); params.push(machineId); }
  const [entries] = await db.execute(historicalJobSql(`SELECT b.id,b.created_at AS createdAt,b.bundle_no AS bundleNo,b.pieces,
    b.theoretical_used_kg AS theoreticalUsedKg,b.hole_scrap_kg AS holeScrapKg,b.cut_blade_scrap_kg AS cutBladeScrapKg,COALESCE(b.shift,j.shift) AS shift,
    j.id AS jobCardId,(SELECT pl.plan_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=j.id) AS planningId,(SELECT pl.template_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=j.id) AS templateId,j.member_name AS memberName,j.section_size AS sectionSize,j.customer_name AS customerName,
    j.project_name_capacity AS projectName,c.material_type AS materialType,m.name AS machineName,
    ${physicalCoilCodeSql()} AS coilInternalId,r.coil_number AS coilNumber,u.name AS enteredByName
    FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id
    JOIN unit1_job_cards j ON j.id=r.job_card_id JOIN unit1_machines m ON m.id=r.machine_id
    JOIN coils c ON c.id=r.coil_id LEFT JOIN users u ON u.id=b.entered_by
    WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC,b.id DESC LIMIT 2001`), params);
  if (entries.length > 2000) throw Object.assign(new Error('More than 2000 entries match. Select a shift or machine before exporting.'), { status: 400 });
  const totals = entries.reduce((sum, entry) => ({
    estimatedUsedKg: sum.estimatedUsedKg + Number(entry.theoreticalUsedKg || 0),
    holeScrapKg: sum.holeScrapKg == null || entry.holeScrapKg == null ? null : sum.holeScrapKg + Number(entry.holeScrapKg),
    cutBladeScrapKg: entry.cutBladeScrapKg == null ? sum.cutBladeScrapKg : Number(sum.cutBladeScrapKg || 0) + Number(entry.cutBladeScrapKg),
  }), { estimatedUsedKg: 0, holeScrapKg: 0, cutBladeScrapKg: null });
  return { date, shift, machineId, entries, summary: historySummary(totals) };
}

module.exports = { productionReport };
