const test=require('node:test'),assert=require('node:assert/strict');
const {migrateUnit1MaterialCollation}=require('../scripts/migrateUnit1MaterialCollation');
test('material-key repair preserves column length, nullability, default and comment',async()=>{
 const calls=[],db={query:async sql=>{calls.push(sql);if(sql.includes('information_schema'))return [[{tableName:'coils',collationName:'utf8mb4_general_ci'},{tableName:'unit1_material_densities',collationName:'utf8mb4_unicode_ci'}]];if(sql.startsWith('SHOW'))return [[{'Create Table':"CREATE TABLE `coils` (\n  `material_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Original key',\n  `id` bigint NOT NULL\n)"}]];return [{}];}};
 assert.deepEqual(await migrateUnit1MaterialCollation(db),['coils.material_type']);
 assert.equal(calls.at(-1),"ALTER TABLE `coils` MODIFY COLUMN `material_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Original key'");
 assert(!calls.some(sql=>/UPDATE |DELETE |CONVERT TO|FOREIGN_KEY_CHECKS/.test(sql)));
});
test('aligned or empty schemas do not run any ALTER statements',async()=>{
 for(const rows of [[],[{tableName:'coils',collationName:'utf8mb4_unicode_ci'}]]){const calls=[],db={query:async sql=>{calls.push(sql);return [rows];}};assert.deepEqual(await migrateUnit1MaterialCollation(db),[]);assert.equal(calls.length,1);}
});
test('mixed-collation material joins are repaired without changing rows or binary identifiers',{skip:process.env.UNIT1_COLLATION_DB_TEST!=='1'},async()=>{
 const fixture=await require('./fixtures/unit1FlowDatabase').unit1FlowDatabase(),db=fixture.db;
 try{
  await db.query('ALTER TABLE coils MODIFY material_type VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL');
  await db.query('ALTER TABLE unit1_material_stock_items MODIFY material_type VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL');
  const [before]=await db.query('SELECT * FROM coils');
  const join='SELECT c.id,d.density_g_cm3 density FROM coils c JOIN unit1_material_densities d ON d.material_type=c.material_type';
  await assert.rejects(db.query(join),{code:'ER_CANT_AGGREGATE_2COLLATIONS'});
  const changed=await migrateUnit1MaterialCollation(db);assert.deepEqual(changed.sort(),['coils.material_type','unit1_material_stock_items.material_type']);
  const [[result]]=await db.query(join);assert.equal(Number(result.density),7.85);
  assert.deepEqual((await db.query('SELECT * FROM coils'))[0],before);
  const [[key]]=await db.query("SELECT COLLATION_NAME collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_hole_checks' AND COLUMN_NAME='request_key'");assert.equal(key.collationName,'ascii_bin');
  assert.deepEqual(await migrateUnit1MaterialCollation(db),[]);
 }finally{await fixture.close();}
});
