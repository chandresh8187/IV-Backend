const test = require("node:test"),
  assert = require("node:assert/strict");
require("dotenv-flow").config({ silent: true });
const mysql = require("mysql2/promise");
const {
  migrateUnit1Maintenance,
} = require("../scripts/migrateUnit1Maintenance");
const {
  startMaintenance,
  finishMaintenance,
  assertMachineAvailable,
} = require("../services/unit1MaintenanceSessions");
const { mutate, overview, history } = require("../services/unit1Maintenance");
test(
  "timed machine maintenance: one active session, server timestamps, exact completion, reports, corrections and retained legacy history",
  { skip: process.env.UNIT1_MAINTENANCE_DB_TEST !== "1" },
  async () => {
    const host = process.env.UNIT1_DB_HOST || process.env.DB_HOST;
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
    const cfg = {
      host,
      port: Number(process.env.UNIT1_DB_PORT || process.env.DB_PORT) || 3306,
      user: process.env.UNIT1_DB_USER || process.env.DB_USER,
      password: process.env.UNIT1_DB_PASSWORD ?? process.env.DB_PASSWORD,
      decimalNumbers: true,
      timezone: "+05:30",
    };
    const name = "unit1_sessions_test_" + Date.now();
    assert.match(name, /^unit1_sessions_test_\d+$/);
    const root = await mysql.createConnection(cfg);
    let db;
    try {
      await root.query("CREATE DATABASE `" + name + "`");
      db = mysql.createPool({ ...cfg, database: name, connectionLimit: 5 });
      await db.query(
        "CREATE TABLE unit1_machines(id BIGINT UNSIGNED PRIMARY KEY,code VARCHAR(30),name VARCHAR(100),is_active TINYINT)"
      );
      await db.query(
        "INSERT INTO unit1_machines VALUES(1,'M1','Former',1),(2,'M2','Punch',1)"
      );
      await db.query(
        "CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY,name VARCHAR(120))"
      );
      await db.query("INSERT INTO users VALUES(7,'Supervisor'),(8,'Manager')");
      await db.query(
        "CREATE TABLE unit1_production_runs(id BIGINT UNSIGNED PRIMARY KEY,machine_id BIGINT UNSIGNED,status VARCHAR(20))"
      );
      await db.query("INSERT INTO unit1_production_runs VALUES(2,2,'running')");
      await migrateUnit1Maintenance(db);
      await migrateUnit1Maintenance(db);
      const plan = await mutate(
        db,
        "plans",
        null,
        {
          machine_id: 1,
          title: "Weekly bearing check",
          interval_days: 7,
          first_due_date: "2026-01-01",
          remind_before_days: 3,
          priority: "normal",
          instructions: "",
          is_active: true,
          request_key: "legacy_plan_test_001",
        },
        8
      );
      const legacy = {
        machine_id: 1,
        plan_id: plan.id,
        service_date: "2026-01-01",
        maintenance_type: "preventive",
        technician: "Engineer",
        work_done: "Historical work",
        cost: 20,
        downtime_minutes: 5,
        request_key: "legacy_record_test_001",
      };
      await mutate(db, "records", null, legacy, 8);
      const body = {
        machine_id: 1,
        plan_id: plan.id,
        note: "Earlier note retained",
        maintenance_reason: "Bearing noise before maintenance",
        request_key: "start_session_test_001",
        started_at: "2000-01-01",
      };
      await assert.rejects(
        startMaintenance(db, { ...body, maintenance_reason: " " }, 7),
        { status: 400 }
      );
      const started = await startMaintenance(db, body, 7);
      assert.equal((await startMaintenance(db, body, 7)).id, started.id);
      await assert.rejects(
        startMaintenance(
          db,
          { ...body, request_key: "start_session_conflict_1" },
          8
        ),
        { status: 409 }
      );
      await assert.rejects(
        startMaintenance(
          db,
          { machine_id: 2, request_key: "start_running_machine_1" },
          7
        ),
        { status: 409 }
      );
      let data = await overview(db);
      assert.equal(data.activeSessions.length, 1);
      assert.equal(data.activeSessions[0].start_note, body.note);
      assert.equal(
        data.activeSessions[0].maintenance_reason,
        body.maintenance_reason
      );
      assert.equal(data.plans[0].status, "in_progress");
      assert.ok(
        Date.parse(data.activeSessions[0].started_at) > Date.parse("2026-01-01")
      );
      await assert.rejects(assertMachineAvailable(db, 1), { status: 409 });
      await db.query(
        "UPDATE unit1_maintenance_sessions SET started_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 90 SECOND) WHERE id=?",
        [started.id]
      );
      const details = {
        work_done: "Checked bearings and replaced seals",
        cost: "125.50",
        cost_basis: "approximate",
        parts_used: "Seal kit",
        notes: "Verified",
        ended_at: "2000-01-01",
      };
      const done = await finishMaintenance(db, started.id, details, 7);
      assert.ok(done.duration_seconds >= 90 && done.duration_seconds < 100);
      const repeated = await finishMaintenance(db, started.id, details, 7);
      assert.equal(repeated.record_id, done.record_id);
      await assert.rejects(
        finishMaintenance(db, started.id, { ...details, cost: 999 }, 7),
        { status: 409 }
      );
      data = await overview(db);
      assert.equal(data.activeSessions.length, 0);
      await assertMachineAvailable(db, 1);
      const report = await history(db);
      assert.equal(report.summary.total, 2);
      assert.equal(report.summary.cost_total, 145.5);
      assert.ok(report.summary.downtime_total >= 6.5);
      const timed = report.rows.find((r) => r.session_id);
      assert.equal(timed.work_done, details.work_done);
      assert.equal(timed.start_note, body.note);
      assert.equal(timed.maintenance_reason, body.maintenance_reason);
      assert.equal(timed.cost_basis, "approximate");
      assert.equal(timed.maintenance_type, "breakdown");
      assert.ok(timed.started_at.endsWith("Z"));
      assert.ok(timed.ended_at.endsWith("Z"));
      assert.equal(timed.technician, "Supervisor");
      assert.equal(report.rows.find((r) => !r.session_id).started_at, null);
      await mutate(
        db,
        "records",
        timed.id,
        { ...timed, cost: 140, reason: "Corrected bill amount", version: 1 },
        8
      );
      await assert.rejects(
        mutate(
          db,
          "records",
          timed.id,
          {
            ...timed,
            cost: 140,
            downtime_minutes: 999,
            reason: "Attempted manual timer edit",
            version: 2,
          },
          8
        ),
        { status: 400 }
      );
      const revised = await history(db);
      assert.equal(
        revised.rows.find((r) => r.session_id).duration_seconds,
        timed.duration_seconds
      );
      assert.equal(revised.summary.cost_total, 160);
      const [[session]] = await db.query(
        "SELECT original_input,completed_input,duration_seconds FROM unit1_maintenance_sessions WHERE id=?",
        [started.id]
      );
      assert.equal(JSON.parse(session.completed_input).cost, 125.5);
      assert.equal(JSON.parse(session.original_input).note, body.note);
      assert.equal(
        JSON.parse(session.original_input).maintenance_reason,
        body.maintenance_reason
      );
      assert.equal(
        JSON.parse(session.completed_input).cost_basis,
        "approximate"
      );
      assert.equal(session.duration_seconds, timed.duration_seconds);
      await mutate(
        db,
        "records",
        timed.id,
        { version: 2, reason: "Record voided for audit test" },
        8,
        true
      );
      assert.equal(
        (await overview(db)).plans[0].last_service_date,
        "2026-01-01"
      );
      await db.query(
        "UPDATE unit1_production_runs SET status='paused' WHERE id=2"
      );
      const race = await Promise.allSettled([
        startMaintenance(
          db,
          { machine_id: 2, request_key: "race_start_session_001" },
          7
        ),
        startMaintenance(
          db,
          { machine_id: 2, request_key: "race_start_session_002" },
          8
        ),
      ]);
      assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        race.find((r) => r.status === "rejected").reason.status,
        409
      );
    } finally {
      if (db) await db.end();
      await root.query("DROP DATABASE IF EXISTS `" + name + "`");
      await root.end();
    }
  }
);
