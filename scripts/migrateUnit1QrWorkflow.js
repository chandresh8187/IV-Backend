async function migrateQrWorkflow(db){
 const [[job]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_job_cards' AND COLUMN_NAME='allowed_coil_sizes'");
 if(!Number(job.n))await db.query('ALTER TABLE unit1_job_cards ADD COLUMN allowed_coil_sizes LONGTEXT NULL');
 const [[width]]=await db.query("SELECT COLUMN_TYPE type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_job_cards' AND COLUMN_NAME='coil_width_mm'");
 if(width?.type!=='decimal(10,3)')await db.query('ALTER TABLE unit1_job_cards MODIFY coil_width_mm DECIMAL(10,3) NOT NULL');
 const [[coil]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='coils' AND COLUMN_NAME='weight_recorded'");
 if(!Number(coil.n))await db.query('ALTER TABLE coils ADD COLUMN weight_recorded TINYINT NOT NULL DEFAULT 1');
 const [[key]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='coils' AND COLUMN_NAME='qr_request_key'");
 if(!Number(key.n))await db.query('ALTER TABLE coils ADD COLUMN qr_request_key VARCHAR(100) NULL, ADD UNIQUE KEY uq_coil_qr_request(qr_request_key)');
 const [weights]=await db.query("SELECT COLUMN_NAME name,COLUMN_TYPE type,IS_NULLABLE nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='coils' AND COLUMN_NAME IN ('estimated_kg','gross_kg','tare_kg','actual_net_kg')");
 for(const weight of weights)if(weight.nullable==='NO'){
  if(!/^decimal\(\d+,\d+\)$/i.test(weight.type))throw new Error('Unexpected coil weight column type.');
  await db.query(`ALTER TABLE coils MODIFY ${weight.name} ${weight.type} NULL`);
 }
 const [columns]=await db.query("SELECT COLUMN_NAME name,IS_NULLABLE nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_coil_weight_settlements' AND COLUMN_NAME IN ('starting_kg','scrap_kg')");
 for(const col of columns)if(col.nullable==='NO')await db.query(`ALTER TABLE unit1_coil_weight_settlements MODIFY ${col.name} DECIMAL(14,3) NULL`);
 const [[member]]=await db.query("SELECT IS_NULLABLE nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_coil_weight_members' AND COLUMN_NAME='starting_kg'");
 if(member?.nullable==='NO')await db.query('ALTER TABLE unit1_coil_weight_members MODIFY starting_kg DECIMAL(14,3) NULL');
}
module.exports={migrateQrWorkflow};
async function migrateQrSizes(db){
 await db.query(`CREATE TABLE IF NOT EXISTS unit1_qr_workflow_revisions(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,entity_type VARCHAR(20) NOT NULL,entity_id BIGINT UNSIGNED NOT NULL,before_data LONGTEXT NOT NULL,after_data LONGTEXT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uq_qr_size_migration(entity_type,entity_id)) ENGINE=InnoDB`);
 const c=await db.getConnection();try{await c.beginTransaction();await c.query('SELECT id FROM unit1_planning_lock WHERE id=1 FOR UPDATE');
  const [jobs]=await c.query('SELECT * FROM unit1_job_cards WHERE allowed_coil_sizes IS NULL ORDER BY id FOR UPDATE');
  const unique=rows=>[...new Map(rows.filter(r=>Number(r.widthMm)>0&&Number(r.thicknessMm)>0).map(r=>[Number(r.widthMm)+':'+Number(r.thicknessMm),{widthMm:Number(r.widthMm),thicknessMm:Number(r.thicknessMm)}])).values()];
  for(const job of jobs){
   const [selected]=await c.execute('SELECT c.width_mm widthMm,c.thickness_mm thicknessMm FROM unit1_job_card_coils jc JOIN coils c ON c.id=jc.coil_id WHERE jc.job_card_id=?',[job.id]);
   const sizes=unique([{widthMm:job.coil_width_mm,thicknessMm:job.coil_thickness_mm},...selected]);
   if(!sizes.length)continue;
   await c.execute('INSERT IGNORE INTO unit1_qr_workflow_revisions(entity_type,entity_id,before_data,after_data) VALUES(?,?,?,?)',['job',job.id,JSON.stringify({job,selected}),JSON.stringify({allowedCoilSizes:sizes,reason:'QR size matching migration; original production quantities and measurements preserved'})]);
   await c.execute('UPDATE unit1_job_cards SET allowed_coil_sizes=? WHERE id=?',[JSON.stringify(sizes),job.id]);
  }
  const [templates]=await c.query('SELECT * FROM unit1_material_templates ORDER BY id FOR UPDATE');
  for(const row of templates){const spec=JSON.parse(row.specification);if(spec.allowedCoilSizes)continue;
   const [links]=await c.execute('SELECT j.allowed_coil_sizes sizes FROM unit1_production_plan_lines l JOIN unit1_job_cards j ON j.id=l.job_card_id WHERE l.template_id=?',[row.id]);
   const sizes=unique([{widthMm:spec.coilWidthMm,thicknessMm:spec.coilThicknessMm},...links.flatMap(l=>JSON.parse(l.sizes||'[]'))]);if(!sizes.length)continue;
   const after={...spec,allowedCoilSizes:sizes};
   await c.execute('INSERT IGNORE INTO unit1_qr_workflow_revisions(entity_type,entity_id,before_data,after_data) VALUES(?,?,?,?)',['template',row.id,row.specification,JSON.stringify(after)]);
   await c.execute('UPDATE unit1_material_templates SET specification=?,version=version+1 WHERE id=?',[JSON.stringify(after),row.id]);
   await c.execute('UPDATE unit1_production_plan_lines SET template_version=? WHERE template_id=?',[Number(row.version)+1,row.id]);
  }
  await c.commit();
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
module.exports.migrateQrSizes=migrateQrSizes;
