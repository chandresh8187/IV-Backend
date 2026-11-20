const {coilCodeFallbackSql}=require('../services/unit1PhysicalCoils');
const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { DEFAULT_FIELDS, FIELDS, parseFields } = require('../services/unit1CoilQr');
const { roundKg } = require('../services/unit1MaterialWeight');
const { numberedCoilUsage } = require('../services/unit1CoilUsage');

const columns = `id,invoice_group_id AS invoiceGroupId,(SELECT ci.total_weight_kg FROM unit1_coil_invoices ci WHERE ci.id=coils.invoice_group_id) AS invoiceTotalWeightKg, COALESCE(public_code,internal_id) AS internalId, supplier, supplier_coil_id AS supplierCoilId,
  (SELECT COALESCE(SUM(wm.starting_kg-(SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_runs wr JOIN unit1_production_bundles b ON b.run_id=wr.id WHERE wr.coil_id=wm.coil_id AND wr.coil_number=wm.coil_number)-(SELECT COALESCE(SUM(${require('../services/unit1RejectedMaterial').rejectedUsedSql('rr')}),0) FROM unit1_production_runs rr WHERE rr.coil_id=wm.coil_id AND rr.coil_number=wm.coil_number)),0) FROM unit1_coil_weight_members wm WHERE wm.coil_id=coils.id) AS finishedResidualKg,
  invoice, DATE_FORMAT(invoice_date,'%Y-%m-%d') AS invoiceDate, tc_number AS tcNumber,
  (SELECT v.name FROM unit1_coil_invoices vi JOIN unit1_vendors v ON v.id=vi.vendor_id WHERE vi.id=coils.invoice_group_id) AS vendorName, vendor_code AS vendorCode, grade, material_type AS materialType, coil_qty AS coilQty, qr_generated_at AS qrGeneratedAt,
  thickness_mm AS thicknessMm, width_mm AS widthMm,
  estimated_kg AS estimatedKg, gross_kg AS grossKg, tare_kg AS tareKg,
  rate_per_kg AS ratePerKg, actual_net_kg AS actualNetKg, actual_net_kg AS totalWeightKg, quality_status AS qualityStatus,
  quality_note AS qualityNote, status, received_at AS receivedAt,weight_recorded AS weightRecorded,
  (SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_runs used_run JOIN unit1_production_bundles b ON b.run_id=used_run.id WHERE used_run.coil_id=coils.id)+(SELECT COALESCE(SUM(${require('../services/unit1RejectedMaterial').rejectedUsedSql('rr')}),0) FROM unit1_production_runs rr WHERE rr.coil_id=coils.id) AS theoreticalUsedKg,
  (SELECT CASE WHEN COUNT(*)<>COUNT(b.hole_scrap_kg) THEN NULL ELSE COALESCE(SUM(b.hole_scrap_kg),0) END FROM unit1_production_runs scrap_run JOIN unit1_production_bundles b ON b.run_id=scrap_run.id WHERE scrap_run.coil_id=coils.id)+${require('../services/unit1RejectedMaterial').rejectedHoleSql('coils','coil')} AS holeScrapKg,
  (SELECT COUNT(DISTINCT coil_number) FROM unit1_production_runs used_run WHERE used_run.coil_id = coils.id) AS usedQty,
  (CASE WHEN status IN ('consumed','closed') THEN 0 ELSE coil_qty - (SELECT COUNT(DISTINCT coil_number) FROM unit1_production_runs used_run WHERE used_run.coil_id = coils.id AND used_run.status <> 'returned') END) AS availableQty`;

function withWeight(coil) {
  const used = Number(coil.theoreticalUsedKg || 0);
  if(Number(coil.weightRecorded)===0)return {...coil,weightRecorded:false,totalWeightKg:null,actualNetKg:null,grossKg:null,estimatedKg:null,theoreticalUsedKg:roundKg(used),theoreticalRemainingKg:null};
  return { ...coil, theoreticalUsedKg: roundKg(used), theoreticalRemainingKg: roundKg(Number(coil.totalWeightKg || 0) - used - Number(coil.finishedResidualKg || 0)), holeScrapKg: coil.holeScrapKg === null ? null : roundKg(coil.holeScrapKg) };
}

router.use(auth);
const {decorateStockRows,stockPositions} = require('../services/unit1CoilStock');

const stockRegister=require('../services/unit1StockRegister');
router.get('/stock-sizes',access([], 'unit1.coils.view'),async(req,res,next)=>{try{res.json({data:await stockRegister.listSizes(db)});}catch(e){next(e);}});
router.post('/stock-sizes',access([], 'unit1.coils.create'),async(req,res,next)=>{const c=await db.getConnection();try{await c.beginTransaction();const data=await require('../services/unit1StockCards').createCard(c,req.body,req.user.id);await c.commit();require('../services/unit1Realtime').publishUnit1Change(req,'coils',{action:'stock_size_added'});res.status(201).json({data});}catch(e){await c.rollback();next(e);}finally{c.release();}});
router.post('/:id/print-qr',access([], 'unit1.coils.view'),async(req,res,next)=>{const c=await db.getConnection();try{await c.beginTransaction();const data=await require('../services/unit1StockQr').invoiceQr(c,req.params.id,req.user.id);await c.commit();res.json({data});}catch(e){await c.rollback();next(e);}finally{c.release();}});
router.get('/stock-invoices',access([], 'unit1.coils.view'),async(req,res,next)=>{try{res.json({data:await stockRegister.listInvoices(db,req.query)});}catch(e){next(e);}});
router.get('/stock-summary',access([], 'unit1.coils.view'),async(req,res,next)=>{try{res.json({data:await stockRegister.listStock(db)});}catch(e){next(e);}});
router.post('/stock-receipts',access([], 'unit1.coils.create'),async(req,res,next)=>{const c=await db.getConnection();try{await c.beginTransaction();const data=await stockRegister.addStock(c,req.body,req.user.id);await c.commit();require('../services/unit1Realtime').publishUnit1Change(req,'coils',{action:'stock_received'});res.status(201).json({data});}catch(e){await c.rollback();next(e);}finally{c.release();}});

async function scanCoil(req, res, next) {
  const internalId = String(req.params.internalId || '');
  let coilNumber = Number(req.params.coilNumber);
  if (!internalId || internalId.length > 80 || (req.params.coilNumber !== undefined && (!/^\d+$/.test(req.params.coilNumber) || !Number.isSafeInteger(coilNumber)))) return res.status(400).json({ error: 'Invalid coil ID or coil number.' });
  try {
    const proofFor = coil => req.params.coilNumber === undefined ? {} : {
      scanProof: require('../services/unit1CoilAssignmentAccess').scanProof(req.user.id, coil),
    };
    if(/^CQ\d{8}$/i.test(internalId)){
      const [[qr]]=await db.execute(`SELECT sq.id,sq.code,sq.material_type materialType,sq.grade,sq.width_mm widthMm,sq.thickness_mm thicknessMm,
        c.invoice,DATE_FORMAT(c.invoice_date,'%Y-%m-%d') invoiceDate,c.tc_number tcNumber,c.vendor_code vendorCode,
        (SELECT v.name FROM unit1_coil_invoices vi JOIN unit1_vendors v ON v.id=vi.vendor_id WHERE vi.id=c.invoice_group_id) vendorName,c.rate_per_kg ratePerKg,c.coil_qty coilQty,CASE WHEN c.weight_recorded=0 THEN NULL ELSE c.actual_net_kg END totalWeightKg,
        (SELECT ci.total_weight_kg FROM unit1_coil_invoices ci WHERE ci.id=c.invoice_group_id) invoiceTotalWeightKg,c.received_at receivedAt
        FROM unit1_stock_qrs sq LEFT JOIN coils c ON c.id=sq.inward_id WHERE sq.code=?`,[internalId.toUpperCase()]);
      if(!qr)return res.status(404).json({error:'Shared coil QR not found.'});
      const [settings]=await db.execute('SELECT fields_json fields FROM unit1_qr_scan_role_fields WHERE role=?',[req.user.role]);const selected=settings.length?parseFields(settings[0].fields):DEFAULT_FIELDS;
      return res.json({data:{stockQrId:qr.id,reference:qr.code,...proofFor({stockQrId:qr.id}),role:req.user.role,fields:FIELDS.filter(f=>selected.includes(f.key)&&Object.hasOwn(qr,f.key)).map(f=>({...f,value:qr[f.key]}))}});
    }
    const [identities] = /^\d{6}$/.test(internalId) ? await db.execute('SELECT batch_id AS batchId,coil_number AS coilNumber,CAST(code AS CHAR) AS reference FROM unit1_coil_identifiers WHERE code=? AND coil_number IS NOT NULL', [internalId]) : [[]];
    const identity = identities[0];
    if (identity) coilNumber = Number(identity.coilNumber);
    if (!identity && req.params.coilNumber === undefined) return res.status(404).json({ error: 'Enter the unique six-digit ID printed on the physical coil label.' });
    const [rows] = identity ? await db.execute(`SELECT ${columns} FROM coils WHERE id=?`, [identity.batchId]) : await db.execute(`SELECT ${columns} FROM coils WHERE public_code = ? OR internal_id = ? LIMIT 1`, [internalId,internalId]);
    const coil = rows[0];
    if (!coil || coilNumber < 1 || coilNumber > Number(coil.coilQty || 1)) return res.status(404).json({ error: 'Coil ID or physical coil number not found.' });
    const [physical] = await db.execute('SELECT CAST(code AS CHAR) AS reference FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number=?', [coil.id,coilNumber]);
    const [settings] = await db.execute('SELECT fields_json AS fields FROM unit1_qr_scan_role_fields WHERE role = ?', [req.user.role]);
    const selected = settings.length ? parseFields(settings[0].fields) : DEFAULT_FIELDS;
    const values = coil;
    res.json({ data: {
      coilId: coil.id,
      ...proofFor({ coilId: coil.id, coilNumber }),
      reference: physical[0]?.reference || coil.internalId,
      inwardReference: coil.internalId,
      coilNumber,
      role: req.user.role,
      fields: FIELDS.filter(field => selected.includes(field.key)).map(field => ({ ...field, value: values[field.key] ?? null })),
    } });
  } catch (error) { next(error); }
}
router.get('/scan/:internalId/:coilNumber', access([], 'unit1.coils.scan'), scanCoil);
router.get('/lookup/:internalId', access([], 'unit1.coils.scan'), scanCoil);

router.get('/:id/physical/:number', access([], 'unit1.coils.view'), async (req,res,next) => {
  if (!/^\d+$/.test(req.params.id) || !/^[1-9]\d*$/.test(req.params.number)) return res.status(400).json({error:'Invalid physical coil.'});
  try {
    const [[coil]] = await db.execute(`SELECT ${columns} FROM coils WHERE id=?`, [req.params.id]);
    const codeSql=coilCodeFallbackSql('(SELECT sq.code FROM unit1_production_runs qr_run JOIN unit1_stock_qrs sq ON sq.id=qr_run.stock_qr_id WHERE qr_run.coil_id=ci.batch_id AND qr_run.coil_number=ci.coil_number ORDER BY qr_run.id DESC LIMIT 1)','ci.code');
    const [[physical]] = await db.execute(`SELECT ${codeSql} AS internalId,ci.coil_number AS coilNumber,EXISTS(SELECT 1 FROM unit1_coil_weight_members wm WHERE wm.coil_id=ci.batch_id AND wm.coil_number=ci.coil_number) AS weightFinished FROM unit1_coil_identifiers ci WHERE ci.batch_id=? AND ci.coil_number=?`, [req.params.id,req.params.number]);
    if (!coil || !physical || Number(physical.coilNumber)>Number(coil.coilQty)) return res.status(404).json({error:'Physical coil not found.'});
    const position=(await stockPositions(db,[coil.id]))[0];
    res.json({data:{...withWeight(coil),theoreticalRemainingKg:null,inwardRemainingKg:position?.remainingKg==null?null:roundKg(position.remainingKg),inwardReference:coil.internalId,...physical,...(physical.weightFinished?{theoreticalRemainingKg:0}:{}),perCoilWeightKg:null}});
  } catch(error) { next(error); }
});

router.get('/:id/usage', access([], 'unit1.coils.view'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
  try {
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Coil batch not found.' });
    const batch = (await decorateStockRows(db,[withWeight(rows[0])]))[0];
    const [settlements] = await db.execute('SELECT wm.coil_number AS coilNumber,s.id AS settlementId,s.scrap_kg AS groupScrapKg FROM unit1_coil_weight_members wm JOIN unit1_coil_weight_settlements s ON s.id=wm.settlement_id WHERE wm.coil_id=?',[batch.id]);
    batch.weightSettlements=settlements;
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(Number(batch.coilQty) / pageSize));
    const page = Math.min(totalPages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const startNumber = (page - 1) * pageSize + 1;
    const count = Math.min(pageSize, Number(batch.coilQty) - startNumber + 1);
    const [runs] = await db.execute(`SELECT r.id AS runId,r.coil_number AS coilNumber,r.status,
      r.produced_pieces AS producedPieces,r.job_card_id AS jobCardId,(SELECT pl.plan_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=r.job_card_id) AS planningId,(SELECT pl.template_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=r.job_card_id) AS templateId,
      j.member_name AS memberName,m.code AS machineCode,m.name AS machineName,
      (SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_bundles b WHERE b.run_id=r.id)+${require('../services/unit1RejectedMaterial').rejectedUsedSql('r')} AS theoreticalUsedKg,
      (SELECT CASE WHEN COUNT(*)<>COUNT(b.hole_scrap_kg) THEN NULL ELSE COALESCE(SUM(b.hole_scrap_kg),0) END FROM unit1_production_bundles b WHERE b.run_id=r.id)+${require('../services/unit1RejectedMaterial').rejectedHoleSql('r')} AS holeScrapKg
      FROM unit1_production_runs r LEFT JOIN unit1_job_cards j ON j.id=r.job_card_id
      LEFT JOIN unit1_machines m ON m.id=r.machine_id
      WHERE r.coil_id=? AND r.coil_number BETWEEN ? AND ? ORDER BY r.coil_number,r.id`, [batch.id, startNumber, startNumber + count - 1]);
    const [identifiers] = await db.execute('SELECT coil_number AS coilNumber,CAST(code AS CHAR) AS internalId FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number BETWEEN ? AND ?', [batch.id,startNumber,startNumber+count-1]);
    const codes = new Map(identifiers.map(row => [Number(row.coilNumber),row.internalId]));
    res.json({ data: { batch, coils: numberedCoilUsage(batch, runs, { startNumber, count }).map(coil => ({...coil,theoreticalRemainingKg:null,internalId:codes.get(coil.coilNumber)})), page, pageSize, totalPages } });
  } catch (error) { next(error); }
});

router.get('/:id', access([], 'unit1.coils.view'), async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Coil not found.' });
    res.json({ data: (await decorateStockRows(db,[withWeight(rows[0])]))[0] });
  } catch (error) { next(error); }
});

router.use((error, _req, res, next) => {
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Internal coil ID already exists.' });
  if (['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
    return res.status(503).json({ error: 'Unit 1 database unavailable or schema needs migration.' });
  }
  next(error);
});

module.exports = router;
module.exports.scanCoil=scanCoil;
