const db = require('../config/db');
const { DateTime } = require('luxon');
const { generateGasManagementPdf } = require('../services/pdf/gasManagementPdfGenerator');
const { checkStockAlerts, GAS_LIMIT_BOTTLES } = require('../services/stockAlertService');
const { getProductionTonsForPeriod, getProductionTonsForRuns, getRunTimeBreakdown } = require('../services/gasProductionService');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const sendError=(res,error)=>res.status(error.status||500).json({success:false,message:error.status?error.message:'Could not complete the gas management request.'});
const parseDateTime=value=>{if(value instanceof Date){const parsed=DateTime.fromJSDate(value).setZone('Asia/Kolkata');return parsed.isValid?parsed:null;}const text=String(value||'').trim();const parsed=text.includes('T')?DateTime.fromISO(text,{zone:'Asia/Kolkata'}):DateTime.fromSQL(text,{zone:'Asia/Kolkata'});return parsed.isValid?parsed:null;};
const validDateTime=value=>Boolean(parseDateTime(value));
const sqlDateTime=value=>parseDateTime(value)?.toFormat('yyyy-MM-dd HH:mm:ss');
const checkStartOrder=async(connection,started)=>{const [rows]=await connection.query('SELECT MAX(finished_at) last_finished FROM gas_bottle_runs');const latest=rows[0]?.last_finished;if(latest&&parseDateTime(started).toMillis()<parseDateTime(latest).toMillis())throw fail('Start time cannot be before the previous gas supply ended.');};
async function readData(queryable=db){
  const month=DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-MM'); const from=`${month}-01 00:00:00`; const to=DateTime.fromISO(`${month}-01`).endOf('month').toFormat('yyyy-MM-dd 23:59:59');
  const [bottles,positions,available,runs,receipts,monthRows,pendingRows,monthRuns]=await Promise.all([
    queryable.query(`SELECT status,COUNT(*) count,ROUND(SUM(remaining_gas_kg),3) gas_kg FROM gas_bottles GROUP BY status`),
    queryable.query(`SELECT b.id,b.bottle_code,b.status,b.position_no,b.filled_weight_kg,b.initial_gas_kg,b.remaining_gas_kg,r.price_per_bottle,gr.started_at,EXISTS(SELECT 1 FROM gas_bottle_runs prior WHERE prior.bottle_id=b.id AND prior.end_reason='paused') was_paused FROM gas_bottles b JOIN gas_bottle_receipts r ON r.id=b.receipt_id LEFT JOIN gas_bottle_runs gr ON gr.bottle_id=b.id AND gr.finished_at IS NULL WHERE b.position_no IS NOT NULL ORDER BY b.position_no`),
    queryable.query("SELECT id,bottle_code,remaining_gas_kg FROM gas_bottles WHERE status='filled' ORDER BY id"),
    queryable.query(`SELECT gr.*,b.bottle_code,b.filled_weight_kg,s.name started_by_name,f.name finished_by_name FROM gas_bottle_runs gr JOIN gas_bottles b ON b.id=gr.bottle_id LEFT JOIN users s ON s.id=gr.started_by LEFT JOIN users f ON f.id=gr.finished_by ORDER BY gr.id DESC LIMIT 100`),
    queryable.query(`SELECT r.*,ROUND(r.bottle_count*r.price_per_bottle,2) total_amount,u.name actor_name FROM gas_bottle_receipts r LEFT JOIN users u ON u.id=r.actor_user_id ORDER BY r.id DESC LIMIT 100`),
    queryable.query(`SELECT ROUND(COALESCE(SUM(consumed_gas_kg),0),3) consumed_kg,ROUND(COALESCE(SUM(consumed_cost),0),2) gas_cost,ROUND(COALESCE(SUM(production_ton),0),3) production_ton FROM gas_bottle_runs WHERE finished_at BETWEEN ? AND ?`,[from,to]),
    queryable.query(`SELECT gr.id,gr.position_no,gr.finished_at,b.bottle_code,b.filled_weight_kg FROM gas_bottle_runs gr JOIN gas_bottles b ON b.id=gr.bottle_id WHERE gr.finished_at IS NOT NULL AND gr.end_reason='finished' AND gr.empty_weight_kg IS NULL AND gr.consumed_gas_kg IS NULL ORDER BY gr.id DESC`),
    queryable.query('SELECT id, finished_at FROM gas_bottle_runs WHERE finished_at BETWEEN ? AND ?', [from,to]),
  ]);
  const productionByRun=await getProductionTonsForRuns(queryable,[...runs[0],...monthRuns[0]]);
  const timeByRun=await getRunTimeBreakdown(queryable,runs[0]);
  for(const run of runs[0]) Object.assign(run,timeByRun.get(Number(run.id))||{});
  for(const run of runs[0])if(run.finished_at){run.production_ton=productionByRun.get(Number(run.id))||0;run.gas_kg_per_ton=run.production_ton&&run.consumed_gas_kg!=null?Number(run.consumed_gas_kg)/run.production_ton:null;}
  const counts=Object.fromEntries(bottles[0].map(x=>[x.status,Number(x.count)])); const monthData=monthRows[0][0]||{}; const production=monthRuns[0].reduce((sum,run)=>sum+(productionByRun.get(Number(run.id))||0),0); const consumed=Number(monthData.consumed_kg||0);
  const running=positions[0].find(x=>x.status==='running')||null;
  const latestReceipt = receipts[0][0] || null;
  const filledBottles=(counts.filled||0)+(counts.ready||0)+(counts.running||0);
  return {summary:{month,kg_per_bottle:425,filled_bottles:filledBottles,low_stock:bottles[0].length>0&&filledBottles<=GAS_LIMIT_BOTTLES,stock_alert_threshold_bottles:GAS_LIMIT_BOTTLES,current_gas_rate:latestReceipt ? Number(latestReceipt.price_per_bottle)/Number(latestReceipt.kg_per_bottle) : 0,stored_filled_bottles:counts.filled||0,ready_bottles:counts.ready||0,running_bottles:counts.running||0,running_bottle_number:running?.position_no||null,empty_bottles:(counts.finished||0)+(counts.empty||0),available_gas_kg:bottles[0].filter(x=>['filled','ready','running'].includes(x.status)).reduce((s,x)=>s+Number(x.gas_kg||0),0),month_consumed_kg:consumed,month_gas_cost:Number(monthData.gas_cost||0),month_production_ton:production,month_gas_kg_per_ton:production?consumed/production:0},positions:positions[0],pending_empty_weights:pendingRows[0],available_bottles:available[0],runs:runs[0],receipts:receipts[0]};
}
const getDashboard=async(req,res)=>{try{return res.json({success:true,data:await readData()});}catch(e){return sendError(res,e);}};
const receiveBottles=async(req,res)=>{let c;try{const count=Number(req.body.bottle_count),kg=425,price=req.body.rate_per_kg != null ? Math.round(Number(req.body.rate_per_kg)*425*100)/100 : Math.round(Number(req.body.price_per_bottle)*425*100)/100,received=sqlDateTime(req.body.received_at || DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-MM-dd HH:mm:ss'));if(!Number.isInteger(count)||count<1||count>200)throw fail('Bottle count must be between 1 and 200.');if(!Number.isFinite(kg)||kg<=0||!Number.isFinite(price)||price<=0)throw fail('Enter valid bottle quantity and rate per kg.');if(!validDateTime(received))throw fail('Select a valid receipt date and time.');c=await db.getConnection();await c.beginTransaction();const [result]=await c.query(`INSERT INTO gas_bottle_receipts (bottle_count,kg_per_bottle,price_per_bottle,supplier,invoice_no,received_at,note,actor_user_id) VALUES (?,?,?,?,?,?,?,?)`,[count,kg,price,req.body.supplier||null,req.body.invoice_no||null,received,req.body.note||null,req.user.id]);const values=[];for(let i=1;i<=count;i++)values.push([result.insertId,`GAS-${result.insertId}-${String(i).padStart(3,'0')}`,kg,kg]);await c.query('INSERT INTO gas_bottles (receipt_id,bottle_code,initial_gas_kg,remaining_gas_kg) VALUES ?',[values]);await c.commit();checkStockAlerts().catch(error=>console.error('Stock alert check failed:',error));req.app.get('io')?.emit('gas_management_updated');return res.status(201).json({success:true,message:`${count} filled gas bottle${count===1?'':'s'} received.`});}catch(e){if(c)await c.rollback().catch(()=>{});return sendError(res,e);}finally{c?.release();}};
const assignBottle=async(req,res)=>{try{const position=Number(req.body.position_no);if(!Number.isInteger(position)||position<1||position>4)throw fail('Position must be from 1 to 4.');throw fail('Use Gas Stock to place a bottle and record its filled weight and any previous empty weight.');}catch(e){return sendError(res,e);}};
const fillPosition=async(req,res)=>{
  let c;
  try {
    const position=Number(req.params.position),weight=Number(req.body.filled_weight_kg);
    if(!Number.isInteger(position)||position<1||position>4)throw fail('Select GAS-1 to GAS-4.');
    if(!Number.isFinite(weight)||weight<=0)throw fail('Enter the filled bottle weight in kg.');
    c=await db.getConnection();await c.beginTransaction();
    const [bottles]=await c.query('SELECT * FROM gas_bottles ORDER BY id FOR UPDATE');
    if(bottles.some(b=>Number(b.position_no)===position))throw fail(`GAS-${position} already has a bottle.`,409);
    const [pendingRows]=await c.query(`SELECT gr.*,b.filled_weight_kg,r.kg_per_bottle,r.price_per_bottle FROM gas_bottle_runs gr JOIN gas_bottles b ON b.id=gr.bottle_id JOIN gas_bottle_receipts r ON r.id=b.receipt_id WHERE gr.position_no=? AND gr.finished_at IS NOT NULL AND gr.end_reason='finished' AND gr.empty_weight_kg IS NULL AND gr.consumed_gas_kg IS NULL ORDER BY gr.id DESC FOR UPDATE`,[position]);
    if(pendingRows.length>1)throw fail(`GAS-${position} has multiple bottles awaiting empty weights. Contact an administrator.`,409);
    const pending=pendingRows[0];
    let emptyWeight,consumed;
    if(pending){
      if(req.body.empty_weight_kg==null||String(req.body.empty_weight_kg).trim()==='')throw fail(`Enter the previous GAS-${position} empty bottle weight before placing a new bottle.`);
      emptyWeight=Number(req.body.empty_weight_kg);
      consumed=Math.round((Number(pending.filled_weight_kg)-emptyWeight)*1000)/1000;
      if(!Number.isFinite(emptyWeight)||emptyWeight<=0||consumed<0||consumed>Number(pending.start_gas_kg))throw fail('Previous empty weight must be positive and gas used cannot exceed the bottle capacity.');
    }
    const next=bottles.find(b=>b.status==='filled'&&b.position_no==null);
    if(!next)throw fail('No unassigned filled bottles remain. Add stock first.',409);
    const startAt=req.body.started_at==null?null:sqlDateTime(req.body.started_at);
    if(req.body.started_at!=null&&!startAt)throw fail('Select a valid gas supply start time.');
    if(startAt){const [active]=await c.query('SELECT id FROM gas_bottle_runs WHERE finished_at IS NULL FOR UPDATE');if(active.length)throw fail('Another bottle is already running. Place this bottle as ready instead.',409);await checkStartOrder(c,startAt);}
    if(startAt&&pending&&parseDateTime(startAt).toMillis()<parseDateTime(pending.finished_at).toMillis())throw fail('New bottle start time cannot be before the previous bottle ended.');
    if(pending){
      const endedAt=sqlDateTime(pending.finished_at);
      const [segments]=await c.query('SELECT id,started_at,finished_at,production_ton FROM gas_bottle_runs WHERE bottle_id=? ORDER BY started_at,id FOR UPDATE',[pending.bottle_id]);
      const latest=segments.at(-1);
      if(Number(latest.id)!==Number(pending.id))throw fail('The previous bottle has a newer running period.',409);
      const [nextRun]=await c.query('SELECT started_at FROM gas_bottle_runs WHERE started_at>=? AND bottle_id<>? ORDER BY started_at LIMIT 1',[pending.started_at,pending.bottle_id]);
      if(parseDateTime(endedAt).toMillis()<parseDateTime(pending.started_at).toMillis() || (nextRun[0] && parseDateTime(endedAt).toMillis()>parseDateTime(nextRun[0].started_at).toMillis()))throw fail('End time must be after this bottle started and no later than the next bottle started.');
      for(const segment of segments){
        const segmentEnd=Number(segment.id)===Number(pending.id)?endedAt:segment.finished_at;
        segment.production_ton=await getProductionTonsForPeriod(c,segment.started_at,segmentEnd);
      }
      const totalProduction=segments.reduce((sum,segment)=>sum+Number(segment.production_ton||0),0);
      const finalGas=Number(pending.start_gas_kg)-consumed;
      const cost=consumed*Number(pending.price_per_bottle)/Number(pending.kg_per_bottle);
      let allocatedGas=0,allocatedCost=0;
      for(const segment of segments){
        const share=totalProduction>0?Number(segment.production_ton||0)/totalProduction:Number(segment.id)===Number(pending.id)?1:0;
        const last=Number(segment.id)===Number(pending.id);
        const segmentGas=last?Math.round((consumed-allocatedGas)*1000)/1000:Math.round(consumed*share*1000)/1000;
        const segmentCost=last?Math.round((cost-allocatedCost)*100)/100:Math.round(cost*share*100)/100;
        allocatedGas+=segmentGas;allocatedCost+=segmentCost;
        await c.query('UPDATE gas_bottle_runs SET finished_at=?,production_ton=?,empty_weight_kg=?,final_gas_kg=?,consumed_gas_kg=?,gas_kg_per_ton=?,consumed_cost=? WHERE id=?',[last?endedAt:segment.finished_at,segment.production_ton,last?emptyWeight:null,last?finalGas:null,segmentGas,totalProduction?consumed/totalProduction:null,segmentCost,segment.id]);
      }
      await c.query('UPDATE gas_bottles SET remaining_gas_kg=? WHERE id=?',[finalGas,pending.bottle_id]);
    }
    await c.query("UPDATE gas_bottles SET status=?,position_no=?,filled_weight_kg=? WHERE id=?",[startAt?'running':'ready',position,weight,next.id]);
    if(startAt)await c.query('INSERT INTO gas_bottle_runs (bottle_id,position_no,started_at,start_gas_kg,started_by,note) VALUES (?,?,?,?,?,?)',[next.id,position,startAt,next.remaining_gas_kg,req.user.id,'Started when placed in Gas Stock']);
    await c.commit();req.app.get('io')?.emit('gas_management_updated');
    return res.json({success:true,message:startAt?`Filled bottle placed in GAS-${position} and gas supply started.`:pending?`GAS-${position} previous empty weight recorded and new filled bottle placed.`:`Filled bottle placed in GAS-${position}.`});
  }catch(e){if(c)await c.rollback().catch(()=>{});return sendError(res,e);}finally{c?.release();}
};
const updateFilledWeight=async(req,res)=>{try{const position=Number(req.params.position),weight=Number(req.body.filled_weight_kg);if(!Number.isInteger(position)||position<1||position>4||!Number.isFinite(weight)||weight<=0)throw fail('Enter a valid GAS slot and filled bottle weight.');const [result]=await db.query("UPDATE gas_bottles SET filled_weight_kg=? WHERE position_no=? AND status IN ('ready','running')",[weight,position]);if(!result.affectedRows)throw fail('No ready or running bottle is in this slot.',404);req.app.get('io')?.emit('gas_management_updated');return res.json({success:true,message:`GAS-${position} filled weight saved.`});}catch(e){return sendError(res,e);}};
const updateStartTime=async(req,res)=>{let c;try{
  const position=Number(req.params.position),started=sqlDateTime(req.body.started_at);
  if(!Number.isInteger(position)||position<1||position>4||!started)throw fail('Select a valid GAS slot and start time.');
  c=await db.getConnection();await c.beginTransaction();
  const [runs]=await c.query("SELECT gr.id,gr.started_at FROM gas_bottle_runs gr JOIN gas_bottles b ON b.id=gr.bottle_id WHERE b.position_no=? AND b.status='running' AND gr.finished_at IS NULL FOR UPDATE",[position]);
  if(!runs.length)throw fail('This bottle is not running.',409);
  const [previous]=await c.query('SELECT MAX(finished_at) last_finished FROM gas_bottle_runs WHERE id<>?',[runs[0].id]);
  if(previous[0]?.last_finished&&parseDateTime(started).toMillis()<parseDateTime(previous[0].last_finished).toMillis())throw fail('Start time cannot be before the previous bottle ended.');
  await c.query('UPDATE gas_bottle_runs SET started_at=? WHERE id=?',[started,runs[0].id]);
  await c.commit();req.app.get('io')?.emit('gas_management_updated');
  return res.json({success:true,message:`GAS-${position} start time saved.`});
}catch(e){if(c)await c.rollback().catch(()=>{});return sendError(res,e);}finally{c?.release();}};
const startBottle=async(req,res)=>{let c;try{const position=Number(req.body.position_no),started=sqlDateTime(req.body.started_at);if(!Number.isInteger(position)||position<1||position>4)throw fail('Select GAS-1 to GAS-4.');if(!validDateTime(started))throw fail('Select a valid start date and time.');c=await db.getConnection();await c.beginTransaction();const [active]=await c.query('SELECT id FROM gas_bottle_runs WHERE finished_at IS NULL FOR UPDATE');if(active.length)throw fail('A bottle is already running. Use Gas change.',409);await checkStartOrder(c,started);const [b]=await c.query("SELECT * FROM gas_bottles WHERE position_no=? AND status='ready' FOR UPDATE",[position]);if(!b.length)throw fail('Select a ready bottle position.',404);if(!(Number(b[0].filled_weight_kg)>0))throw fail('Enter the filled bottle weight before starting.',409);await c.query("UPDATE gas_bottles SET status='running' WHERE id=?",[b[0].id]);await c.query('INSERT INTO gas_bottle_runs (bottle_id,position_no,started_at,start_gas_kg,started_by,note) VALUES (?,?,?,?,?,?)',[b[0].id,position,started,b[0].remaining_gas_kg,req.user.id,req.body.note||null]);await c.commit();req.app.get('io')?.emit('gas_management_updated');return res.json({success:true,message:`GAS-${position} started.`});}catch(e){if(c)await c.rollback().catch(()=>{});return sendError(res,e);}finally{c?.release();}};
const switchBottle=async(req,res)=>{let c;try{const nextPosition=Number(req.body.next_position_no),finished=sqlDateTime(req.body.finished_at),started=sqlDateTime(req.body.started_at),finalGas=Number(req.body.final_gas_kg||0);if(!validDateTime(finished)||!validDateTime(started)||started<finished)throw fail('Enter valid finish and next start times.');if(!Number.isFinite(finalGas)||finalGas<0)throw fail('Final remaining gas cannot be negative.');c=await db.getConnection();await c.beginTransaction();const [runRows]=await c.query('SELECT gr.*,b.receipt_id,b.position_no,b.remaining_gas_kg,r.kg_per_bottle,r.price_per_bottle FROM gas_bottle_runs gr JOIN gas_bottles b ON b.id=gr.bottle_id JOIN gas_bottle_receipts r ON r.id=b.receipt_id WHERE gr.finished_at IS NULL FOR UPDATE');if(!runRows.length)throw fail('No running bottle found. Use Start Bottle first.',409);const run=runRows[0];if(finalGas>Number(run.start_gas_kg))throw fail('Final gas cannot exceed starting gas.');const [nextRows]=await c.query("SELECT * FROM gas_bottles WHERE position_no=? AND status='ready' FOR UPDATE",[nextPosition]);if(!nextRows.length)throw fail('The selected next position is not ready.',404);const consumed=Number(run.start_gas_kg)-finalGas;const production=await getProductionTonsForPeriod(c,run.started_at,finished),rate=Number(run.price_per_bottle)/Number(run.kg_per_bottle),cost=consumed*rate;await c.query('UPDATE gas_bottle_runs SET finished_at=?,final_gas_kg=?,consumed_gas_kg=?,production_ton=?,gas_kg_per_ton=?,consumed_cost=?,finished_by=?,note=COALESCE(?,note) WHERE id=?',[finished,finalGas,consumed,production,production?consumed/production:null,cost,req.user.id,req.body.note||null,run.id]);await c.query("UPDATE gas_bottles SET status='finished',remaining_gas_kg=?,position_no=NULL WHERE id=?",[finalGas,run.bottle_id]);const next=nextRows[0];await c.query("UPDATE gas_bottles SET status='running' WHERE id=?",[next.id]);await c.query('INSERT INTO gas_bottle_runs (bottle_id,position_no,started_at,start_gas_kg,started_by) VALUES (?,?,?,?,?)',[next.id,nextPosition,started,next.remaining_gas_kg,req.user.id]);await c.commit();req.app.get('io')?.emit('gas_management_updated');return res.json({success:true,message:`Position ${run.position_no} finished and position ${nextPosition} started.`,data:{consumed_gas_kg:consumed,production_ton:production}});}catch(e){if(c)await c.rollback().catch(()=>{});return sendError(res,e);}finally{c?.release();}};
const downloadPdf=async(req,res)=>{try{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');res.setHeader('Pragma','no-cache');const data=await readData();const pdf=await generateGasManagementPdf(data);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Length',pdf.length);res.setHeader('Content-Disposition','inline; filename="gas-vaporizer-report.pdf"');return res.end(pdf);}catch(e){return sendError(res,e);}};
const changeBottle = async (req, res) => {
  let connection;
  try {
    const number = Number(req.body.bottle_number);
    const changedAt = sqlDateTime(req.body.changed_at);
    const reason=req.body.finish_reason==='paused'?'paused':'finished';
    if (!Number.isInteger(number) || number < 1 || number > 4) throw fail('Next bottle number must be between 1 and 4.');
    if (!changedAt) throw fail('Select a valid gas change date and time.');
    connection = await db.getConnection();
    await connection.beginTransaction();
    // Lock the complete inventory to serialize simultaneous bottle changes.
    const [bottles] = await connection.query('SELECT * FROM gas_bottles ORDER BY id FOR UPDATE');
    const [activeRows] = await connection.query('SELECT gr.*,b.filled_weight_kg FROM gas_bottle_runs gr JOIN gas_bottles b ON b.id=gr.bottle_id WHERE gr.finished_at IS NULL FOR UPDATE');
    const active = activeRows[0];
    if (!active) throw fail('No gas bottle is running. Start a filled bottle from Gas Stock first.',409);
    if (active && Number(active.position_no) === number) throw fail('The next bottle number cannot be the currently running bottle.', 409);
    const activeStart = active && (active.started_at instanceof Date ? DateTime.fromJSDate(active.started_at) : parseDateTime(active.started_at));
    if (activeStart && parseDateTime(changedAt).toMillis() < activeStart.toMillis()) throw fail('Gas change time cannot be before the current bottle started.');
    const next = bottles.find(b => b.status === 'ready' && Number(b.position_no) === number);
    if (!next || !(Number(next.filled_weight_kg)>0)) throw fail(`GAS-${number} needs a filled bottle weight before it can start.`, 409);
    if (active) {
      const filledWeight = Number(active.filled_weight_kg);
      if (!(filledWeight>0)) throw fail('The running bottle has no recorded filled weight. Correct its weight in Gas Stock first.',409);
      const production = await getProductionTonsForPeriod(connection, active.started_at, changedAt);
      await connection.query('UPDATE gas_bottle_runs SET finished_at=?,end_reason=?,production_ton=?,finished_by=?,note=? WHERE id=?', [changedAt,reason,production,req.user.id,`Bottle ${active.position_no} ${reason}; bottle ${number} started`,active.id]);
      if(reason==='paused')await connection.query("UPDATE gas_bottles SET status='ready' WHERE id=?",[active.bottle_id]);
      else await connection.query("UPDATE gas_bottles SET status='finished',position_no=NULL WHERE id=?", [active.bottle_id]);
    }
    await connection.query("UPDATE gas_bottles SET status='running' WHERE id=?", [next.id]);
    await connection.query('INSERT INTO gas_bottle_runs (bottle_id,position_no,started_at,start_gas_kg,started_by,note) VALUES (?,?,?,?,?,?)', [next.id, number, changedAt, next.remaining_gas_kg, req.user.id, active ? `Started after bottle ${active.position_no}` : 'Initial running bottle']);
    await connection.commit();
    checkStockAlerts().catch(error => console.error('Stock alert check failed:', error));
    req.app.get('io')?.emit('gas_management_updated');
    return res.json({ success: true, message: `Bottle ${active.position_no} ${reason==='paused'?'paused for later use':'finished'}. Bottle ${number} is now running.`, data: { running_bottle_number: number } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return sendError(res, error);
  } finally { connection?.release(); }
};
module.exports={getDashboard,receiveBottles,assignBottle,fillPosition,updateFilledWeight,updateStartTime,startBottle,switchBottle,changeBottle,downloadPdf};
