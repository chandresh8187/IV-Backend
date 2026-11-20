const {withPunchNames}=require('../services/unit1PunchNames');
async function migrateUnit1PunchNames(db){
 const [[column]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_job_card_holes' AND COLUMN_NAME='punch_name'");
 if(!Number(column.n))await db.query("ALTER TABLE unit1_job_card_holes ADD COLUMN punch_name ENUM('A','B','C','D','E') CHARACTER SET ascii COLLATE ascii_bin NULL AFTER punch_size");
 await db.query(`CREATE TABLE IF NOT EXISTS unit1_punch_name_revisions(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,entity_type VARCHAR(20) NOT NULL,entity_id BIGINT UNSIGNED NOT NULL,before_data LONGTEXT NOT NULL,after_data LONGTEXT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uq_punch_name_backfill(entity_type,entity_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
 const c=await db.getConnection();try{await c.beginTransaction();await c.query('SELECT id FROM unit1_planning_lock WHERE id=1 FOR UPDATE');
  const [holes]=await c.query('SELECT id,job_card_id jobCardId,punch_size punchSize,punch_name punchName,profile,target_mm targetMm FROM unit1_job_card_holes WHERE is_active=1 ORDER BY job_card_id,sequence_no FOR UPDATE');
  const jobs=new Map();for(const hole of holes){if(!jobs.has(hole.jobCardId))jobs.set(hole.jobCardId,[]);jobs.get(hole.jobCardId).push(hole);}
  for(const [id,rows]of jobs){if(rows.every(h=>h.punchName))continue;const after=withPunchNames(rows,{legacy:true});
   await c.execute('INSERT IGNORE INTO unit1_punch_name_revisions(entity_type,entity_id,before_data,after_data) VALUES(?,?,?,?)',['job',id,JSON.stringify(rows),JSON.stringify(after)]);
   for(const row of after)if(row.punchName)await c.execute('UPDATE unit1_job_card_holes SET punch_name=? WHERE id=? AND punch_name IS NULL',[row.punchName,row.id]);
  }
  const [templates]=await c.query('SELECT id,version,specification FROM unit1_material_templates FOR UPDATE');
  for(const row of templates){const spec=JSON.parse(row.specification);if(!spec.holes?.some(h=>h.punchName===undefined))continue;const after={...spec,holes:withPunchNames(spec.holes,{legacy:true})};
   await c.execute('INSERT IGNORE INTO unit1_punch_name_revisions(entity_type,entity_id,before_data,after_data) VALUES(?,?,?,?)',['template',row.id,row.specification,JSON.stringify(after)]);
   await c.execute('UPDATE unit1_material_templates SET specification=?,version=version+1 WHERE id=?',[JSON.stringify(after),row.id]);
   await c.execute('UPDATE unit1_production_plan_lines SET template_version=? WHERE template_id=?',[Number(row.version)+1,row.id]);
  }
  const [checks]=await c.query('SELECT id,report_snapshot snapshot FROM unit1_hole_checks WHERE report_snapshot IS NOT NULL FOR UPDATE');
  for(const row of checks){const snapshot=JSON.parse(row.snapshot);if(!snapshot.measurements?.some(h=>h.punchName===undefined))continue;const after={...snapshot,measurements:withPunchNames(snapshot.measurements,{legacy:true})};
   await c.execute('INSERT IGNORE INTO unit1_punch_name_revisions(entity_type,entity_id,before_data,after_data) VALUES(?,?,?,?)',['inspection',row.id,row.snapshot,JSON.stringify(after)]);
   await c.execute('UPDATE unit1_hole_checks SET report_snapshot=? WHERE id=?',[JSON.stringify(after),row.id]);
  }
  await c.commit();
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
module.exports={migrateUnit1PunchNames};
