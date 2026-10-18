require('dotenv-flow').config({ silent: true });
const db = require('../config/unit1Db');
const { holeScrapKg } = require('../services/unit1MaterialWeight');

const additions = [
  ['rate_per_kg', 'DECIMAL(10,2) NULL AFTER actual_net_kg'],
  ['invoice_date', 'DATE NULL AFTER invoice'],
  ['tc_number', 'VARCHAR(100) NULL AFTER invoice_date'],
  ['vendor_code', 'VARCHAR(100) NULL AFTER supplier'],
  ['material_type', 'VARCHAR(20) NULL AFTER grade'],
  ['coil_qty', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER material_type'],
  ['qr_generated_at', 'DATETIME(3) NULL AFTER coil_qty'],
];

async function migrateUnit1Coils() {
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_material_densities (
    material_type VARCHAR(20) NOT NULL PRIMARY KEY,
    density_g_cm3 DECIMAL(7,4) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  for (const materialType of ['MS', 'GL', 'GP', 'Posmac']) {
    await db.execute('INSERT IGNORE INTO unit1_material_densities (material_type, density_g_cm3) VALUES (?, 7.8500)', [materialType]);
  }
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_shift_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    day_start TIME NOT NULL,
    day_end TIME NOT NULL,
    night_start TIME NOT NULL,
    night_end TIME NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.execute("INSERT IGNORE INTO unit1_shift_settings (id, day_start, day_end, night_start, night_end) VALUES (1, '08:00', '20:00', '20:00', '08:00')");
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('superadmin','production_manager','plant_manager','admin','supervisor','labour') NOT NULL,
    assigned_shift ENUM('Day','Night') NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query("ALTER TABLE users MODIFY role ENUM('superadmin','production_manager','plant_manager','admin','supervisor','labour') NOT NULL");
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_fcm_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    installation_id VARCHAR(100) NOT NULL,
    fcm_token VARCHAR(512) NOT NULL,
    device_type ENUM('android','ios') NOT NULL DEFAULT 'android',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_fcm_installation (installation_id),
    UNIQUE KEY uq_unit1_fcm_token (fcm_token),
    KEY idx_unit1_fcm_user (user_id),
    CONSTRAINT fk_unit1_fcm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS user_permission_overrides (
    user_id BIGINT UNSIGNED NOT NULL,
    permission_key VARCHAR(120) NOT NULL,
    allowed TINYINT(1) NOT NULL,
    PRIMARY KEY (user_id, permission_key),
    CONSTRAINT fk_unit1_permission_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS coils (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    internal_id VARCHAR(80) NOT NULL,
    supplier VARCHAR(160) NOT NULL,
    supplier_coil_id VARCHAR(100) NOT NULL,
    invoice VARCHAR(100) NULL,
    grade VARCHAR(100) NOT NULL,
    thickness_mm DECIMAL(10,3) NOT NULL,
    width_mm DECIMAL(10,3) NOT NULL,
    estimated_kg DECIMAL(12,3) NOT NULL,
    gross_kg DECIMAL(12,3) NOT NULL,
    tare_kg DECIMAL(12,3) NOT NULL,
    actual_net_kg DECIMAL(12,3) NOT NULL,
    quality_status ENUM('pending','passed','hold') NOT NULL DEFAULT 'pending',
    quality_note TEXT NULL,
    status ENUM('in_stock','allocated','consumed','closed') NOT NULL DEFAULT 'in_stock',
    received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_coils_internal_id (internal_id),
    KEY idx_coils_supplier (supplier),
    KEY idx_coils_received_at (received_at),
    CONSTRAINT chk_coils_weights CHECK (gross_kg > tare_kg AND tare_kg >= 0 AND estimated_kg > 0),
    CONSTRAINT chk_coils_dimensions CHECK (thickness_mm > 0 AND width_mm > 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coils'`,
  );
  const existing = new Set(rows.map(row => row.COLUMN_NAME));
  for (const [name, definition] of additions) {
    if (existing.has(name)) continue;
    await db.query(`ALTER TABLE coils ADD COLUMN \`${name}\` ${definition}`);
  }
  const [gradeTables] = await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unit1_material_grades'`,
  );
  if (!gradeTables.length) {
    await db.query(`CREATE TABLE unit1_material_grades (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      material_type VARCHAR(20) NOT NULL,
      grade_value VARCHAR(100) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_unit1_material_grade (material_type, grade_value)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const defaults = [
      ['MS', 'Normal'], ['MS', 'E250'], ['MS', 'E350'],
      ['GL', '550 MPA'], ['Posmac', '550 MPA'],
    ];
    await db.query(
      `INSERT INTO unit1_material_grades (material_type, grade_value) VALUES ${defaults.map(() => '(?, ?)').join(', ')}`,
      defaults.flat(),
    );
  }
  await db.execute("DELETE FROM unit1_material_grades WHERE material_type = 'GP'");
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_qr_scan_role_fields (
    role VARCHAR(32) NOT NULL PRIMARY KEY,
    fields_json JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_machines (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_machine_code (code),
    KEY idx_unit1_machines_active_name (is_active, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [assignedMachineColumns] = await db.query("SHOW COLUMNS FROM users LIKE 'assigned_machine_id'");
  if (!assignedMachineColumns.length) await db.query('ALTER TABLE users ADD COLUMN assigned_machine_id BIGINT UNSIGNED NULL AFTER assigned_shift');
  const [assignedMachineIndexes] = await db.query("SHOW INDEX FROM users WHERE Key_name = 'idx_unit1_user_assigned_machine'");
  if (!assignedMachineIndexes.length) await db.query('ALTER TABLE users ADD INDEX idx_unit1_user_assigned_machine (assigned_machine_id)');
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_production_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    machine_id BIGINT UNSIGNED NOT NULL,
    coil_id BIGINT UNSIGNED NOT NULL,
    coil_number INT UNSIGNED NOT NULL,
    product_type VARCHAR(40) NOT NULL,
    status ENUM('running','paused','completed') NOT NULL DEFAULT 'running',
    produced_pieces INT UNSIGNED NOT NULL DEFAULT 0,
    run_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_resumed_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_run_coil (coil_id, coil_number),
    KEY idx_unit1_run_machine_status (machine_id, status),
    KEY idx_unit1_run_status_started (status, started_at),
    CONSTRAINT fk_unit1_run_machine FOREIGN KEY (machine_id) REFERENCES unit1_machines(id),
    CONSTRAINT fk_unit1_run_coil FOREIGN KEY (coil_id) REFERENCES coils(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_production_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id BIGINT UNSIGNED NOT NULL,
    event_type ENUM('started','pieces_added','paused','resumed','completed') NOT NULL,
    pieces_delta INT UNSIGNED NOT NULL DEFAULT 0,
    note VARCHAR(255) NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_unit1_events_run_time (run_id, created_at),
    CONSTRAINT fk_unit1_event_run FOREIGN KEY (run_id) REFERENCES unit1_production_runs(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_job_cards (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    job_date DATE NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    project_name_capacity VARCHAR(180) NOT NULL,
    production_qty INT UNSIGNED NOT NULL,
    structure_type VARCHAR(40) NOT NULL,
    member_name VARCHAR(120) NOT NULL,
    section_size VARCHAR(100) NOT NULL,
    shift ENUM('day','night') NOT NULL,
    cut_length_mm DECIMAL(10,2) NOT NULL,
    machine_id BIGINT UNSIGNED NULL,
    material_type VARCHAR(20) NOT NULL,
    coil_width_mm DECIMAL(10,2) NOT NULL,
    coil_thickness_mm DECIMAL(8,3) NOT NULL,
    punch_size VARCHAR(100) NOT NULL,
    status ENUM('open','completed','cancelled') NOT NULL DEFAULT 'open',
    archived_at DATETIME(3) NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_unit1_job_machine_status (machine_id,status),
    CONSTRAINT fk_unit1_job_machine FOREIGN KEY (machine_id) REFERENCES unit1_machines(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query('ALTER TABLE unit1_job_cards MODIFY machine_id BIGINT UNSIGNED NULL');
  const [plannedMachineColumns] = await db.query("SHOW COLUMNS FROM unit1_job_cards LIKE 'planned_machine_id'");
  if (!plannedMachineColumns.length) await db.query('ALTER TABLE unit1_job_cards ADD COLUMN planned_machine_id BIGINT UNSIGNED NULL AFTER machine_id');
  const [plannedMachineIndexes] = await db.query("SHOW INDEX FROM unit1_job_cards WHERE Key_name = 'idx_unit1_job_planned_machine'");
  if (!plannedMachineIndexes.length) await db.query('ALTER TABLE unit1_job_cards ADD INDEX idx_unit1_job_planned_machine (planned_machine_id)');
  await db.query('UPDATE unit1_job_cards SET planned_machine_id=machine_id WHERE planned_machine_id IS NULL AND machine_id IS NOT NULL');
  const [jobColumns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unit1_job_cards'");
  if (!jobColumns.some(row => row.COLUMN_NAME === 'archived_at')) await db.query('ALTER TABLE unit1_job_cards ADD COLUMN archived_at DATETIME(3) NULL');
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_job_card_holes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    job_card_id BIGINT UNSIGNED NOT NULL,
    sequence_no INT UNSIGNED NOT NULL,
    profile ENUM('l_flange','r_flange','web','lip') NOT NULL,
    punch_size VARCHAR(100) NULL,
    target_mm DECIMAL(10,2) NOT NULL,
    UNIQUE KEY uq_unit1_job_hole_sequence (job_card_id,sequence_no),
    CONSTRAINT fk_unit1_job_hole_job FOREIGN KEY (job_card_id) REFERENCES unit1_job_cards(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [holeColumns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unit1_job_card_holes'");
  if (!holeColumns.some(row => row.COLUMN_NAME === 'punch_size')) await db.query('ALTER TABLE unit1_job_card_holes ADD COLUMN punch_size VARCHAR(100) NULL AFTER profile');
  const [runColumns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unit1_production_runs'");
  const runNames = new Set(runColumns.map(row => row.COLUMN_NAME));
  if (!runNames.has('job_card_id')) await db.query('ALTER TABLE unit1_production_runs ADD COLUMN job_card_id BIGINT UNSIGNED NULL, ADD KEY idx_unit1_run_job (job_card_id), ADD CONSTRAINT fk_unit1_run_job FOREIGN KEY (job_card_id) REFERENCES unit1_job_cards(id)');
  if (!runNames.has('hole_checked_at')) await db.query('ALTER TABLE unit1_production_runs ADD COLUMN hole_checked_at DATETIME(3) NULL, ADD COLUMN hole_checked_by BIGINT UNSIGNED NULL');
  await db.query("ALTER TABLE unit1_production_runs MODIFY status ENUM('setup','running','paused','completed','returned') NOT NULL DEFAULT 'setup'");
  await db.query("ALTER TABLE unit1_production_events MODIFY event_type ENUM('started','pieces_added','paused','resumed','completed','coil_inserted','hole_checked','bundle_added','coil_returned') NOT NULL");
  // Preserve every use of a physical coil, while allowing only one active use.
  if (!runNames.has('active_coil_number')) await db.query("ALTER TABLE unit1_production_runs ADD COLUMN active_coil_number INT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status IN ('setup','running','paused') THEN coil_number ELSE NULL END) STORED, ADD UNIQUE KEY uq_unit1_active_coil (coil_id,active_coil_number)");
  const [oldCoilIndex] = await db.query("SHOW INDEX FROM unit1_production_runs WHERE Key_name='uq_unit1_run_coil'");
  if (oldCoilIndex.length) await db.query('ALTER TABLE unit1_production_runs ADD INDEX idx_unit1_coil_history (coil_id,coil_number), DROP INDEX uq_unit1_run_coil');
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_run_hole_checks (
    run_id BIGINT UNSIGNED NOT NULL,
    job_card_hole_id BIGINT UNSIGNED NOT NULL,
    measured_mm DECIMAL(10,2) NOT NULL,
    checked_by BIGINT UNSIGNED NOT NULL,
    checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (run_id,job_card_hole_id),
    CONSTRAINT fk_unit1_check_run FOREIGN KEY (run_id) REFERENCES unit1_production_runs(id),
    CONSTRAINT fk_unit1_check_hole FOREIGN KEY (job_card_hole_id) REFERENCES unit1_job_card_holes(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_hole_checks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id BIGINT UNSIGNED NOT NULL,
    check_type ENUM('first_piece','recheck') NOT NULL,
    checked_by BIGINT UNSIGNED NOT NULL,
    checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_unit1_hole_checks_run (run_id, checked_at),
    CONSTRAINT fk_unit1_hole_check_run FOREIGN KEY (run_id) REFERENCES unit1_production_runs(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_hole_check_measurements (
    check_id BIGINT UNSIGNED NOT NULL,
    job_card_hole_id BIGINT UNSIGNED NOT NULL,
    measured_mm DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (check_id, job_card_hole_id),
    CONSTRAINT fk_unit1_measurement_check FOREIGN KEY (check_id) REFERENCES unit1_hole_checks(id),
    CONSTRAINT fk_unit1_measurement_hole FOREIGN KEY (job_card_hole_id) REFERENCES unit1_job_card_holes(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_production_bundles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id BIGINT UNSIGNED NOT NULL,
    bundle_no INT UNSIGNED NOT NULL,
    pieces INT UNSIGNED NOT NULL,
    member_name VARCHAR(120) NOT NULL,
    entered_by BIGINT UNSIGNED NOT NULL,
    hole_check_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_bundle_no (run_id,bundle_no),
    CONSTRAINT fk_unit1_bundle_run FOREIGN KEY (run_id) REFERENCES unit1_production_runs(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [bundleColumns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unit1_production_bundles'");
  if (!bundleColumns.some(row => row.COLUMN_NAME === 'hole_check_id')) await db.query('ALTER TABLE unit1_production_bundles ADD COLUMN hole_check_id BIGINT UNSIGNED NULL, ADD KEY idx_unit1_bundle_check (hole_check_id)');
  if (!bundleColumns.some(row => row.COLUMN_NAME === 'shift')) await db.query("ALTER TABLE unit1_production_bundles ADD COLUMN shift ENUM('day','night') NULL AFTER pieces");
  if (!bundleColumns.some(row => row.COLUMN_NAME === 'shift_date')) await db.query('ALTER TABLE unit1_production_bundles ADD COLUMN shift_date DATE NULL AFTER shift');
  if (!bundleColumns.some(row => row.COLUMN_NAME === 'theoretical_used_kg')) await db.query('ALTER TABLE unit1_production_bundles ADD COLUMN theoretical_used_kg DECIMAL(14,4) NULL AFTER pieces');
  if (!bundleColumns.some(row => row.COLUMN_NAME === 'density_g_cm3')) await db.query('ALTER TABLE unit1_production_bundles ADD COLUMN density_g_cm3 DECIMAL(7,4) NULL AFTER theoretical_used_kg');
  if (!bundleColumns.some(row => row.COLUMN_NAME === 'hole_scrap_kg')) await db.query('ALTER TABLE unit1_production_bundles ADD COLUMN hole_scrap_kg DECIMAL(14,4) NULL AFTER density_g_cm3');
  await db.query(`UPDATE unit1_production_bundles b
    JOIN unit1_production_runs r ON r.id=b.run_id
    JOIN coils c ON c.id=r.coil_id
    JOIN unit1_job_cards j ON j.id=r.job_card_id
    JOIN unit1_material_densities d ON d.material_type=c.material_type
    SET b.density_g_cm3=d.density_g_cm3,
        b.theoretical_used_kg=ROUND(c.width_mm*c.thickness_mm*j.cut_length_mm*b.pieces*d.density_g_cm3/1000000,4)
    WHERE b.theoretical_used_kg IS NULL AND c.width_mm>0 AND c.thickness_mm>0 AND j.cut_length_mm>0`);
  const [unmeasuredBundles] = await db.query(`SELECT b.id,b.pieces,b.density_g_cm3 AS densityGcm3,
    c.thickness_mm AS thicknessMm,j.id AS jobCardId,j.punch_size AS punchSize
    FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id
    JOIN coils c ON c.id=r.coil_id JOIN unit1_job_cards j ON j.id=r.job_card_id
    WHERE b.hole_scrap_kg IS NULL`);
  const holesByJob = new Map();
  for (const bundle of unmeasuredBundles) {
    if (!holesByJob.has(bundle.jobCardId)) {
      const [holes] = await db.execute('SELECT COALESCE(punch_size, ?) AS punchSize FROM unit1_job_card_holes WHERE job_card_id=? ORDER BY sequence_no', [bundle.punchSize, bundle.jobCardId]);
      holesByJob.set(bundle.jobCardId, holes);
    }
    const scrapKg = holeScrapKg({ holes: holesByJob.get(bundle.jobCardId), thicknessMm: bundle.thicknessMm, pieces: bundle.pieces, densityGcm3: bundle.densityGcm3 });
    if (scrapKg !== null) await db.execute('UPDATE unit1_production_bundles SET hole_scrap_kg=? WHERE id=?', [Number(scrapKg.toFixed(4)), bundle.id]);
  }
  await db.query(`INSERT INTO unit1_hole_checks (run_id,check_type,checked_by,checked_at)
    SELECT hc.run_id,'first_piece',MIN(hc.checked_by),MIN(hc.checked_at)
    FROM unit1_run_hole_checks hc LEFT JOIN unit1_hole_checks c ON c.run_id=hc.run_id AND c.check_type='first_piece'
    WHERE c.id IS NULL GROUP BY hc.run_id`);
  await db.query(`INSERT IGNORE INTO unit1_hole_check_measurements (check_id,job_card_hole_id,measured_mm)
    SELECT c.id,hc.job_card_hole_id,hc.measured_mm FROM unit1_run_hole_checks hc
    JOIN unit1_hole_checks c ON c.run_id=hc.run_id AND c.check_type='first_piece'`);
  await db.query(`UPDATE unit1_production_bundles b JOIN unit1_hole_checks c ON c.run_id=b.run_id AND c.check_type='first_piece'
    SET b.hole_check_id=c.id WHERE b.hole_check_id IS NULL`);
}

if (require.main === module) {
  migrateUnit1Coils()
    .then(() => console.log('Unit 1 coil schema is ready.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.end());
}

module.exports = { migrateUnit1Coils };
