const {productionWeightKg,holeScrapKg}=require('./unit1MaterialWeight');
const {validateRejectedLines}=require('./unit1RejectedLines');
const fail=message=>Object.assign(new Error(message),{status:409});
const weightKeys=['rejectedUsedKg','rejectedHoleScrapKg','rejectedCutBladeScrapKg','rejectedWeightKg'];
const roundWeights=raw=>Object.fromEntries(weightKeys.map(key=>[key,raw[key]==null?null:Number(raw[key].toFixed(4))]));

function singleRejectionWeight(run,holes,pieces){
 const inputs={widthMm:Number(run.widthMm),thicknessMm:Number(run.thicknessMm),lengthMm:Number(run.cutLengthMm),pieces:Number(pieces),densityGcm3:Number(run.densityGcm3??7.85)};
 if(run.cutBladeSizeMm!=null)Object.assign(inputs,{cutBladeSizeMm:Number(run.cutBladeSizeMm),cutBladeThicknessMm:Number(run.cutBladeThicknessMm)});
 const {blankKg,bladeKg,usedKg}=productionWeightKg(inputs),holesKg=holeScrapKg({...inputs,holes});
 if(usedKg==null||(holesKg!=null&&holesKg>blankKg))throw fail('Valid coil dimensions, cut length and hole sizes are required for rejected material weight.');
 return {
  raw:{rejectedUsedKg:usedKg,rejectedHoleScrapKg:holesKg,rejectedCutBladeScrapKg:bladeKg,rejectedWeightKg:holesKg==null?null:blankKg-holesKg},
  inputs:{...inputs,holes:holes.map(h=>({punchSize:h.punchSize}))},
 };
}
function rejectionWeight(run,holes,pieces,rejectedLines){
 if(rejectedLines==null){
  const weight=singleRejectionWeight(run,holes,pieces);
  return {...roundWeights(weight.raw),rejectionWeightInputs:weight.inputs};
 }
 const lines=validateRejectedLines(rejectedLines);
 if(lines.reduce((sum,line)=>sum+line.pieces,0)!==Number(pieces))throw fail('Rejected total must match the cut-length lines.');
 const weights=lines.map(line=>singleRejectionWeight({...run,cutLengthMm:line.cutLengthMm},holes,line.pieces));
 // Sum before rounding so splitting a quantity into lines cannot change stock use.
 const total=Object.fromEntries(weightKeys.map(key=>[key,weights.some(weight=>weight.raw[key]==null)?null:weights.reduce((sum,weight)=>sum+weight.raw[key],0)]));
 return {
  ...roundWeights(total),
  rejectedLines:lines.map((line,i)=>({...line,...roundWeights(weights[i].raw)})),
  rejectionWeightInputs:{
   widthMm:Number(run.widthMm),thicknessMm:Number(run.thicknessMm),densityGcm3:Number(run.densityGcm3??7.85),pieces:Number(pieces),
   ...(run.cutBladeSizeMm==null?{}:{cutBladeSizeMm:Number(run.cutBladeSizeMm),cutBladeThicknessMm:Number(run.cutBladeThicknessMm)}),
   lines:weights.map(weight=>weight.inputs),
  },
 };
}
// Each saved inspection adds NEW rejected pieces. Good bundles remain independent.
const rejectedUsedSql=(runAlias)=>`(SELECT COALESCE(SUM(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rej.report_snapshot,'$.rejectedUsedKg')),'null') AS DECIMAL(18,4))),0) FROM unit1_hole_checks rej WHERE rej.run_id=${runAlias}.id)`;
const rejectedBladeSql=(runAlias)=>`(SELECT COALESCE(SUM(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rej.report_snapshot,'$.rejectedCutBladeScrapKg')),'null') AS DECIMAL(18,4))),0) FROM unit1_hole_checks rej WHERE rej.run_id=${runAlias}.id)`;
const rejectedHoleSql=(alias,scope='run')=>`(SELECT CASE WHEN SUM(CASE WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(rej.report_snapshot,'$.rejectedPieces')) AS UNSIGNED)>0 AND (JSON_EXTRACT(rej.report_snapshot,'$.rejectedHoleScrapKg') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(rej.report_snapshot,'$.rejectedHoleScrapKg'))='null') THEN 1 ELSE 0 END)>0 THEN NULL ELSE COALESCE(SUM(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rej.report_snapshot,'$.rejectedHoleScrapKg')),'null') AS DECIMAL(18,4))),0) END FROM unit1_hole_checks rej WHERE ${scope==='coil'?`rej.run_id IN (SELECT rr.id FROM unit1_production_runs rr WHERE rr.coil_id=${alias}.id)`:`rej.run_id=${alias}.id`})`;
async function rejectedStock(db,{q='',page=1}={}){
 page=Number(page);if(!Number.isSafeInteger(page)||page<1)throw Object.assign(new Error('Invalid page.'),{status:400});
 const where="CAST(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.rejectedPieces')) AS UNSIGNED)>0 AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.customerName')),'') LIKE ? OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.memberName')),'') LIKE ?)",params=['%'+String(q).slice(0,120)+'%','%'+String(q).slice(0,120)+'%'];
 const source=' FROM unit1_hole_checks hc WHERE '+where;
 const [[summary]]=await db.execute(`SELECT COUNT(*) total,COALESCE(SUM(JSON_EXTRACT(hc.report_snapshot,'$.rejectedPieces')),0) rejectedNos,COALESCE(SUM(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.rejectedUsedKg')),'null') AS DECIMAL(18,4))),0) usedKg,COALESCE(SUM(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.rejectedWeightKg')),'null') AS DECIMAL(18,4))),0) knownWeightKg,SUM(JSON_EXTRACT(hc.report_snapshot,'$.rejectedWeightKg') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.rejectedWeightKg'))='null') unknownWeights`+source,params);
 const [rows]=await db.execute('SELECT hc.id,hc.checked_at checkedAt,hc.remarks,hc.report_snapshot snapshot'+source+' ORDER BY hc.checked_at DESC,hc.id DESC LIMIT 30 OFFSET '+((page-1)*30),params);
 return {...summary,rejectedWeightKg:Number(summary.unknownWeights)>0?null:Number(summary.knownWeightKg),page,pageSize:30,items:rows.map(({snapshot,...row})=>({...JSON.parse(snapshot),...row}))};
}
module.exports={rejectionWeight,rejectedUsedSql,rejectedBladeSql,rejectedHoleSql,rejectedStock};
