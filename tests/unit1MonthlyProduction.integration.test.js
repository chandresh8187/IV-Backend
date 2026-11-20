const test=require('node:test'),assert=require('node:assert/strict');
const {monthlyProduction}=require('../services/unit1MonthlyProduction');
test('SQL monthly summary allocates multi-coil weighbridge totals once and refreshes corrected historical months', {skip:process.env.UNIT1_MONTHLY_DB_TEST!=='1'},async()=>{
 require('dotenv-flow').config({silent:true});
 const mysql=require('mysql2/promise');
 const host=process.env.UNIT1_DB_HOST||process.env.DB_HOST;
 assert.ok(['127.0.0.1','localhost'].includes(host));
 const config={host,port:Number(process.env.UNIT1_DB_PORT||process.env.DB_PORT)||3306,user:process.env.UNIT1_DB_USER||process.env.DB_USER,password:process.env.UNIT1_DB_PASSWORD??process.env.DB_PASSWORD,decimalNumbers:true};
 const name='unit1_monthly_test_'+Date.now();assert.match(name,/^unit1_monthly_test_\d+$/);
 const root=await mysql.createConnection(config);let pool;
 try {
  await root.query('CREATE DATABASE `'+name+'`');pool=mysql.createPool({...config,database:name});
  await pool.query('CREATE TABLE unit1_production_runs(id INT PRIMARY KEY,coil_id INT,coil_number INT) ENGINE=InnoDB');
  await pool.query('CREATE TABLE unit1_production_bundles(id INT PRIMARY KEY,run_id INT,shift_date DATE,created_at DATETIME,theoretical_used_kg DECIMAL(14,4),hole_scrap_kg DECIMAL(14,4),cut_blade_scrap_kg DECIMAL(14,4)) ENGINE=InnoDB');
  await pool.query('CREATE TABLE unit1_coil_weight_members(coil_id INT,coil_number INT,settlement_id INT,PRIMARY KEY(coil_id,coil_number)) ENGINE=InnoDB');
  await pool.query('CREATE TABLE unit1_coil_weight_settlements(id INT PRIMARY KEY,starting_kg DECIMAL(14,3),material_kg DECIMAL(14,3)) ENGINE=InnoDB');
  await pool.query('INSERT INTO unit1_production_runs VALUES(1,1,1),(2,2,1),(3,3,1),(4,1,1)');
  await pool.query("INSERT INTO unit1_production_bundles VALUES(1,1,'2026-09-30',NOW(),500,10,NULL),(2,2,'2026-10-01',NOW(),400,10,2),(3,3,'2026-10-02',NOW(),200,5,1),(4,4,'2026-09-30',NOW(),100,2,NULL)");
  await pool.query('INSERT INTO unit1_coil_weight_members VALUES(1,1,7),(2,1,7)');
  await pool.query('INSERT INTO unit1_coil_weight_settlements VALUES(7,1200,900)');
  const oct=await monthlyProduction(pool,'2026-10'),sep=await monthlyProduction(pool,'2026-09');
  assert.equal(oct.confirmedProductionKg,360);assert.equal(sep.confirmedProductionKg,540);
  assert.equal(oct.productionKg,554);assert.equal(oct.cutBladeScrapKg,3);assert.equal(oct.isEstimated,true);assert.equal(oct.coilUsedKg,680);
  await pool.query('UPDATE unit1_coil_weight_settlements SET material_kg=1000 WHERE id=7');
  assert.equal((await monthlyProduction(pool,'2026-09')).confirmedProductionKg,600);
  assert.equal((await monthlyProduction(pool,'2026-10')).productionKg,594);
 }finally{if(pool)await pool.end();await root.query('DROP DATABASE `'+name+'`');await root.end();}
});
