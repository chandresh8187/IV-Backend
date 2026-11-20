const {DateTime}=require('luxon');
const {roundKg}=require('./unit1MaterialWeight');
function monthRange(raw,now=DateTime.now()) {
  const month=raw==null||raw===''?now.setZone('Asia/Kolkata').toFormat('yyyy-MM'):String(raw);
  const start=DateTime.fromISO(month+'-01',{zone:'Asia/Kolkata'});
  if(!/^\d{4}-\d{2}$/.test(month)||!start.isValid)throw Object.assign(new Error('Enter a valid month (YYYY-MM).'),{status:400});
  return {month,start:start.toISODate(),end:start.plus({months:1}).toISODate(),monthLabel:start.toFormat('LLLL yyyy')};
}
// Largest-remainder gram allocation keeps each group's original total exactly.
function allocateKg(total,rows) {
  const grams=Math.round(Number(total)*1000),weight=rows.reduce((sum,row)=>sum+Number(row.usedKg),0);
  if(!Number.isSafeInteger(grams)||grams<0||!(weight>0))return null;
  const parts=rows.map(row=>{const exact=grams*Number(row.usedKg)/weight;return {month:row.month,grams:Math.floor(exact),fraction:exact-Math.floor(exact)};});
  let remainder=grams-parts.reduce((sum,row)=>sum+row.grams,0);
  const priority=[...parts].sort((a,b)=>b.fraction-a.fraction||a.month.localeCompare(b.month));
  for(let i=0;i<remainder;i++)priority[i%priority.length].grams++;
  return Object.fromEntries(parts.map(row=>[row.month,row.grams/1000]));
}
function summarizeMonthly(range,monthly,groups) {
  let coilUsedKg=0,holeScrapKg=0,totalScrapKg=0,confirmedProductionKg=0,estimatedProductionKg=0,pendingBundles=0,unknownHoleBundles=0,unknownEstimatedBundles=0,allocationIssue=false,unknownStartingWeight=false;
  let cutBladeScrapKg=0, hasBladeScrap=false;
  for(const row of monthly) {
    const holes=Number(row.holeKg||0);holeScrapKg+=holes;unknownHoleBundles+=Number(row.unknownHoles);
    const blade=Number(row.bladeKg||0);cutBladeScrapKg+=blade;hasBladeScrap ||= row.bladeKg!=null;
    if(row.settlementId==null) {
      coilUsedKg+=Number(row.usedKg||0);totalScrapKg+=holes+blade;
      pendingBundles+=Number(row.bundleCount);unknownEstimatedBundles+=Number(row.unknownHoles);
      // Missing hole measurements are not silently treated as zero scrap.
      if(!Number(row.unknownHoles))estimatedProductionKg+=Number(row.usedKg||0)-holes-blade;
    }
  }
  const byGroup=new Map();for(const row of groups){const key=String(row.settlementId);if(!byGroup.has(key))byGroup.set(key,[]);byGroup.get(key).push(row);}
  for(const rows of byGroup.values()) {
    const weightKnown=rows[0].startingKg!=null;
    const used=weightKnown?allocateKg(rows[0].startingKg,rows):Object.fromEntries(rows.map(row=>[row.month,Number(row.usedKg)])),material=allocateKg(rows[0].materialKg,rows);
    if(!weightKnown)unknownStartingWeight=true;
    if(!used||!material){allocationIssue=true;continue;}
    coilUsedKg+=used[range.month]||0;confirmedProductionKg+=material[range.month]||0;
    totalScrapKg+=(used[range.month]||0)-(material[range.month]||0);
  }
  const other=totalScrapKg-holeScrapKg-cutBladeScrapKg;
  const unknown=unknownEstimatedBundles>0||allocationIssue;
  return {...range,bundleCount:monthly.reduce((sum,row)=>sum+Number(row.bundleCount),0),coilUsedKg:roundKg(coilUsedKg),holeScrapKg:unknownHoleBundles?null:roundKg(holeScrapKg),
    cutBladeScrapKg:hasBladeScrap?roundKg(cutBladeScrapKg):null,
    otherScrapKg:unknownStartingWeight||pendingBundles||unknownHoleBundles||other<-.001?null:roundKg(other),totalScrapKg:unknown||unknownStartingWeight?null:roundKg(totalScrapKg),
    productionKg:unknown?null:roundKg(confirmedProductionKg+estimatedProductionKg),
    productionTonnes:unknown?null:roundKg(confirmedProductionKg+estimatedProductionKg)/1000,
    confirmedProductionKg:roundKg(confirmedProductionKg),estimatedProductionKg:roundKg(estimatedProductionKg),
    pendingBundles,unknownHoleBundles,isEstimated:pendingBundles>0,allocationIssue,unknownStartingWeight,scrapSplitIssue:!unknownStartingWeight&&other<-.001,
    allocationBasis:'Finished-coil weighbridge totals allocated across production months by calculated coil usage.'};
}
async function monthlyProduction(db,raw) {
  const range=monthRange(raw),c=await db.getConnection();
  try {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();
    const [monthly]=await c.execute(`SELECT wm.settlement_id settlementId,COUNT(*) bundleCount,
      SUM(b.theoretical_used_kg) usedKg,SUM(COALESCE(b.hole_scrap_kg,0)) holeKg,SUM(b.hole_scrap_kg IS NULL) unknownHoles,
      SUM(b.cut_blade_scrap_kg) bladeKg
      FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id
      LEFT JOIN unit1_coil_weight_members wm ON wm.coil_id=r.coil_id AND wm.coil_number=r.coil_number
      WHERE COALESCE(b.shift_date,DATE(b.created_at))>=? AND COALESCE(b.shift_date,DATE(b.created_at))<? GROUP BY wm.settlement_id`,[range.start,range.end]);
    const ids=monthly.filter(row=>row.settlementId!=null).map(row=>row.settlementId);
    const [groups]=ids.length?await c.execute(`SELECT wm.settlement_id settlementId,DATE_FORMAT(COALESCE(b.shift_date,DATE(b.created_at)),'%Y-%m') month,
      SUM(b.theoretical_used_kg) usedKg,MAX(s.starting_kg) startingKg,MAX(s.material_kg) materialKg
      FROM unit1_coil_weight_members wm JOIN unit1_coil_weight_settlements s ON s.id=wm.settlement_id
      JOIN unit1_production_runs r ON r.coil_id=wm.coil_id AND r.coil_number=wm.coil_number
      JOIN unit1_production_bundles b ON b.run_id=r.id WHERE wm.settlement_id IN (${ids.map(()=>'?').join(',')})
      GROUP BY wm.settlement_id,DATE_FORMAT(COALESCE(b.shift_date,DATE(b.created_at)),'%Y-%m')`,ids):[[]];
    const result=summarizeMonthly(range,monthly,groups);await c.commit();return result;
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}
module.exports={monthRange,allocateKg,summarizeMonthly,monthlyProduction};
