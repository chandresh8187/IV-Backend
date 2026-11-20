const test = require("node:test"),
  assert = require("node:assert/strict");
require("dotenv-flow").config({ silent: true });
const mysql = require("mysql2/promise");
const { mutate, overview, history } = require("../services/unit1Maintenance");
const {
  migrateUnit1Maintenance,
} = require("../scripts/migrateUnit1Maintenance");
const {
  sendMaintenanceReminders,
} = require("../services/unit1MaintenanceReminders");
const { DateTime } = require("luxon");
test(
  "MySQL maintenance: atomic corrections, history, recurrence, idempotency and reminders",
  { skip: process.env.UNIT1_MAINTENANCE_DB_TEST !== "1" },
  async () => {
    const host = process.env.UNIT1_DB_HOST || process.env.DB_HOST;
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
    const config = {
      host,
      port: Number(process.env.UNIT1_DB_PORT || process.env.DB_PORT) || 3306,
      user: process.env.UNIT1_DB_USER || process.env.DB_USER,
      password: process.env.UNIT1_DB_PASSWORD ?? process.env.DB_PASSWORD,
      decimalNumbers: true,
      timezone: "+05:30",
    };
    const name = "unit1_maintenance_test_" + Date.now();
    assert.match(name, /^unit1_maintenance_test_\d+$/);
    const root = await mysql.createConnection(config);
    let pool;
    try {
      await root.query("CREATE DATABASE `" + name + "`");
      pool = mysql.createPool({
        ...config,
        database: name,
        connectionLimit: 5,
      });
      await pool.query(
        "CREATE TABLE unit1_machines(id BIGINT UNSIGNED PRIMARY KEY,code VARCHAR(30),name VARCHAR(100),is_active TINYINT)"
      );
      await pool.query(
        "INSERT INTO unit1_machines VALUES(1,'M1','Roll former',1),(2,'M2','Punch',1),(3,'M3','Old machine',0)"
      );
      await pool.query(
        "CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY,name VARCHAR(100),role VARCHAR(30),status VARCHAR(20))"
      );
      await pool.query(
        "INSERT INTO users VALUES(1,'Manager','plant_manager','active'),(2,'Supervisor','supervisor','active'),(3,'Inactive','admin','inactive')"
      );
      await pool.query(
        "CREATE TABLE unit1_fcm_tokens(user_id BIGINT UNSIGNED,fcm_token VARCHAR(512))"
      );
      await pool.query(
        "INSERT INTO unit1_fcm_tokens VALUES(1,'valid'),(1,'expired'),(2,'denied'),(3,'inactive')"
      );
      await migrateUnit1Maintenance(pool);
      await migrateUnit1Maintenance(pool);
      assert.equal((await overview(pool)).unscheduled.length, 2);
      const p = {
        machine_id: 1,
        title: "Lubrication",
        interval_days: 30,
        first_due_date: "2026-01-01",
        remind_before_days: 3,
        priority: "high",
        instructions: "Oil rollers",
        is_active: true,
        request_key: "plan_request_0001",
      };
      const a = await mutate(pool, "plans", null, p, 1);
      assert.equal((await mutate(pool, "plans", null, p, 1)).id, a.id);
      await assert.rejects(
        mutate(pool, "plans", null, { ...p, title: "changed" }, 1),
        { status: 409 }
      );
      const b = await mutate(
        pool,
        "plans",
        null,
        { ...p, title: "Inspect guards", request_key: "plan_request_0002" },
        1
      );
      const r = {
        machine_id: 1,
        plan_id: a.id,
        service_date: "2026-01-10",
        maintenance_type: "preventive",
        technician: "Engineer",
        work_done: "Lubricated",
        parts_used: "Oil",
        cost: 100,
        downtime_minutes: 20,
        notes: "Actual work",
        request_key: "record_request_0001",
      };
      const first = await mutate(pool, "records", null, r, 1);
      const late = await mutate(
        pool,
        "records",
        null,
        {
          ...r,
          service_date: "2026-02-01",
          request_key: "record_request_0002",
        },
        1
      );
      await mutate(
        pool,
        "records",
        null,
        {
          ...r,
          service_date: "2025-12-01",
          request_key: "record_request_0003",
        },
        1
      );
      let o = await overview(pool, "2026-02-02");
      assert.equal(
        o.plans.find((x) => x.id === a.id).next_due_date,
        "2026-03-03"
      );
      const old = await history(pool, {});
      assert.equal(old.summary.cost_total, 300);
      await mutate(
        pool,
        "records",
        late.id,
        {
          ...r,
          plan_id: b.id,
          service_date: "2026-02-01",
          cost: 200,
          version: 1,
          reason: "Wrong schedule selected",
        },
        1
      );
      o = await overview(pool, "2026-02-02");
      assert.equal(
        o.plans.find((x) => x.id === a.id).next_due_date,
        "2026-02-09"
      );
      assert.equal(
        o.plans.find((x) => x.id === b.id).next_due_date,
        "2026-03-03"
      );
      await assert.rejects(
        mutate(
          pool,
          "records",
          late.id,
          { ...r, version: 1, reason: "Stale edit" },
          1
        ),
        { status: 409 }
      );
      await mutate(
        pool,
        "records",
        late.id,
        { version: 2, reason: "Duplicate visit" },
        1,
        true
      );
      o = await overview(pool, "2026-02-02");
      assert.equal(
        o.plans.find((x) => x.id === b.id).next_due_date,
        "2026-01-01"
      );
      assert.equal((await history(pool, {})).summary.cost_total, 200);
      assert.equal((await history(pool, { state: "all" })).summary.total, 3);
      assert.equal(
        (await history(pool, { from: "2026-01-01", to: "2026-01-31" })).summary
          .total,
        1
      );
      await mutate(
        pool,
        "records",
        first.id,
        {
          ...r,
          cost: "",
          downtime_minutes: "",
          version: 1,
          reason: "Amount was not actually measured",
        },
        1
      );
      assert.equal((await history(pool, {})).summary.cost_recorded, 1);
      assert.equal(
        (await mutate(pool, "records", null, r, 1)).id,
        first.id,
        "original retry remains idempotent after correction"
      );
      const concurrent = await Promise.all([
        mutate(
          pool,
          "records",
          null,
          { ...r, request_key: "parallel_request_01" },
          1
        ),
        mutate(
          pool,
          "records",
          null,
          { ...r, request_key: "parallel_request_01" },
          1
        ),
      ]);
      assert.equal(concurrent[0].id, concurrent[1].id);
      const [[audits]] = await pool.query(
        "SELECT COUNT(*) n FROM unit1_maintenance_revisions"
      );
      assert.equal(audits.n, 9);
      const [[original]] = await pool.query(
        "SELECT original_input FROM unit1_maintenance_records WHERE id=?",
        [first.id]
      );
      assert.equal(JSON.parse(original.original_input).cost, 100);
      await pool.query("UPDATE unit1_machines SET is_active=0 WHERE id=1");
      assert.equal((await overview(pool)).plans[0].status, "paused");
      await pool.query("UPDATE unit1_machines SET is_active=1 WHERE id=1");
      let calls = 0;
      const firebase = {
        configured: () => true,
        messaging: () => ({
          sendEachForMulticast: async (payload) => {
            calls++;
            assert.deepEqual(payload.tokens, ["valid", "expired"]);
            return {
              successCount: 1,
              responses: [
                { success: true },
                {
                  success: false,
                  error: {
                    code: "messaging/registration-token-not-registered",
                  },
                },
              ],
            };
          },
        }),
      };
      const permitted = async ({ userId }) => userId === 1;
      const options = {
        db: pool,
        firebase,
        permitted,
        now: DateTime.fromISO("2026-10-28T09:00:00", { zone: "Asia/Kolkata" }),
      };
      assert.equal(
        (
          await sendMaintenanceReminders({
            ...options,
            now: options.now.set({ hour: 8 }),
          })
        ).sent,
        0
      );
      assert.equal(
        (
          await sendMaintenanceReminders({
            ...options,
            firebase: { configured: () => false },
          })
        ).sent,
        0
      );
      assert.equal((await sendMaintenanceReminders(options)).sent, 1);
      assert.equal((await sendMaintenanceReminders(options)).sent, 0);
      assert.equal(calls, 1);
      const [[tokens]] = await pool.query(
        "SELECT COUNT(*) n FROM unit1_fcm_tokens WHERE user_id=1"
      );
      assert.equal(tokens.n, 1);
    } finally {
      if (pool) await pool.end();
      await root.query("DROP DATABASE IF EXISTS `" + name + "`");
      await root.end();
    }
  }
);
