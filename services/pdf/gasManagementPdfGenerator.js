const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { DateTime } = require('luxon');
const num = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const parse = value => value instanceof Date ? DateTime.fromJSDate(value).setZone('Asia/Kolkata') : DateTime.fromSQL(String(value || ''), { zone: 'Asia/Kolkata' });
const stamp = value => { const d = parse(value); return d.isValid ? d.toFormat('dd LLL yyyy hh:mm a') : '-'; };

async function generateGasManagementPdf({ summary = {}, receipts = [], runs = [] }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.04,.12,.23); const muted = rgb(.36,.42,.5);
  let page; let y;
  const draw = (value, x, top, size = 9, font = regular, color = ink) => page.drawText(String(value ?? '-').normalize('NFKD').replace(/[^\x20-\x7E]/g,''), { x, y: top, size, font, color });
  function wrap(value, width) {
    const lines = []; let line = '';
    for (const word of String(value ?? '-').split(/\s+/)) { const candidate = line ? `${line} ${word}` : word; if (regular.widthOfTextAtSize(candidate,8) > width && line) { lines.push(line); line = word; } else line = candidate; }
    if (line) lines.push(line); return lines;
  }
  const columns = [['Date / time',38,120],['Transaction',162,315],['Connected time',485,77],['Production kg',566,83],['Amount Rs',653,80],['Recorded by',737,66]];
  function header() { page.drawRectangle({x:34,y:y-18,width:774,height:24,color:ink}); columns.forEach(c=>draw(c[0],c[1],y-10,8,bold,rgb(1,1,1))); y-=24; }
  function addPage(first = false) {
    page=pdf.addPage([841.89,595.28]); y=558;
    draw('IV SQUARE STRUCTURE INDIA PVT LTD',34,y,15,bold); draw('GAS STOCK REPORT',665,y,11,bold); y-=25;
    draw(`Generated: ${DateTime.now().setZone('Asia/Kolkata').toFormat('dd LLL yyyy hh:mm a')} | IST | 1 bottle = 425 kg`,34,y,9,regular,muted); y-=22;
    if(first) {
      page.drawRectangle({x:34,y:y-58,width:774,height:58,color:rgb(.95,.95,.98),borderColor:rgb(.84,.88,.93),borderWidth:1});
      draw('Current plant stock',46,y-17,10,bold);
      draw(`Running bottle: ${summary.running_bottle_number || 'Not started'}`,46,y-40,11,bold);
      draw(`Filled bottles in plant: ${num(summary.filled_bottles)}`,290,y-40,11,bold);
      draw(`Current gas rate: Rs ${Number(summary.current_gas_rate || 0).toFixed(2)} / kg`,555,y-40,11,bold); y-=78;
    }
    header();
  }
  const events = [];
  const periodCounts = runs.reduce((counts,run)=>{counts[run.bottle_id]=(counts[run.bottle_id]||0)+1;return counts;},{});
  receipts.forEach(r=>events.push({time:r.received_at,description:`Stock received: ${r.bottle_count} bottles (${num(r.bottle_count*425)} kg) added to plant. Rate: Rs ${(Number(r.price_per_bottle)/Number(r.kg_per_bottle || 425)).toFixed(2)} / kg`,amount:r.total_amount ?? r.bottle_count*r.price_per_bottle,actor:r.actor_name}));
  runs.forEach(r=>{
    events.push({time:r.started_at,description:`Bottle ${r.position_no} started supplying gas`,actor:r.started_by_name});
    if(r.finished_at) { const next=String(r.note || '').match(/bottle (\d+) started/i)?.[1]; const minutes=Math.max(0,Math.floor(parse(r.finished_at).diff(parse(r.started_at),'minutes').minutes)); const measured=r.consumed_gas_kg!=null; const estimate=(periodCounts[r.bottle_id]||0)>1?'estimated ':''; const usage=measured ? `${r.empty_weight_kg!=null ? `empty ${num(r.empty_weight_kg)} kg, ` : ''}${estimate}gas used ${num(r.consumed_gas_kg)} kg` : r.end_reason==='paused' ? 'gas use pending until this bottle is finally emptied' : 'empty weight and gas used pending'; const stopped=Math.floor(Number(r.stopped_seconds||0)/60),active=Math.floor(Number(r.production_active_seconds||0)/60); events.push({time:r.finished_at,description:`GAS-${r.position_no} ${r.end_reason==='paused'?'paused':'finished'}${next ? `; GAS-${next} started` : ''}. Filled ${num(r.filled_weight_kg)} kg, ${usage}. Production stopped ${Math.floor(stopped/60)}h ${stopped%60}m; active ${Math.floor(active/60)}h ${active%60}m. Started: ${stamp(r.started_at)}`,duration:`${Math.floor(minutes/60)}h ${minutes%60}m`,production:Number(r.production_ton || 0)*1000,amount:r.consumed_cost,actor:r.finished_by_name}); }
  });
  events.sort((a,b)=>parse(b.time).toMillis()-parse(a.time).toMillis());
  addPage(true);
  events.forEach((event,index)=>{
    const values=[stamp(event.time),event.description,event.duration||'-',event.production==null?'-':num(event.production),event.amount==null?'-':num(event.amount),event.actor||'-'];
    const lines=values.map((value,i)=>wrap(value,columns[i][2])); const height=Math.max(34,...lines.map(l=>l.length*12+12));
    if(y-height<40)addPage();
    if(index%2)page.drawRectangle({x:34,y:y-height,width:774,height,color:rgb(.95,.95,.98)});
    lines.forEach((cell,i)=>cell.forEach((line,j)=>draw(line,columns[i][1],y-14-j*12,8)));
    y-=height;
  });
  if(!events.length)draw('No gas stock transactions recorded.',38,y-20,10);
  pdf.getPages().forEach((p,i)=>p.drawText(`Gas Stock Report | Latest recorded transactions | Page ${i+1} of ${pdf.getPageCount()}`,{x:34,y:20,size:8,font:regular,color:muted}));
  return Buffer.from(await pdf.save());
}
module.exports={generateGasManagementPdf};
