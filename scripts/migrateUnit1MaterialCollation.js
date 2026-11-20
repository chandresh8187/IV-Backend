// Only shared material keys are normalized. Binary IDs, passwords and audit JSON
// keep their existing collations and every column retains its other attributes.
const tables=['coils','unit1_job_cards','unit1_material_stock_items','unit1_material_densities','unit1_material_grades'];
async function migrateUnit1MaterialCollation(db){
 const [columns]=await db.query(`SELECT TABLE_NAME tableName,COLUMN_NAME columnName,COLLATION_NAME collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='material_type' AND TABLE_NAME IN (${tables.map(()=>'?').join(',')})`,tables);
 const changed=[];
 for(const col of columns){
  if(col.collationName==='utf8mb4_unicode_ci')continue;
  const table='`'+col.tableName.replaceAll('`','``')+'`';
  const [[schema]]=await db.query('SHOW CREATE TABLE '+table);
  const definition=schema['Create Table'].split('\n').map(line=>line.trim().replace(/,$/,'')).find(line=>line.startsWith('`material_type` '));
  const prefix=/^(`material_type`\s+(?:var)?char\(\d+\))(?:\s+CHARACTER SET \w+)?(?:\s+COLLATE \w+)?/i;
  if(!definition||!prefix.test(definition))throw Error('Unexpected material_type definition on '+col.tableName+'; collation repair stopped without changing this column.');
  const repaired=definition.replace(prefix,'$1 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await db.query('ALTER TABLE '+table+' MODIFY COLUMN '+repaired);
  changed.push(col.tableName+'.material_type');
 }
 return changed;
}
module.exports={migrateUnit1MaterialCollation};
if(require.main===module){
 require('dotenv-flow').config({silent:true});const db=require('../config/unit1Db');
 migrateUnit1MaterialCollation(db).then(changed=>console.log(JSON.stringify({normalizedMaterialColumns:changed}))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.end());
}
