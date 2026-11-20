const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  vm = require("vm"),
  path = require("path");
require("dotenv-flow").config({ silent: true });
const mysql = require("mysql2/promise");
const { returnBottleToStock } = require("../services/gasBottleReturnService");
const { DateTime } = require("luxon");
test(
  "MySQL gas return preserves actuals and run history, empties slots, retries atomically and resumes in another slot",
  { skip: process.env.GAS_RETURN_DB_TEST !== "1" },
  async () => {
    const host = process.env.DB_HOST;
    assert.ok(
      ["localhost", "127.0.0.1", "::1"].includes(host),
      "Disposable localhost DB only"
    );
    const config = {
      host,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      decimalNumbers: true,
      timezone: "+05:30",
    };
    const name = "gas_return_test_" + Date.now();
    assert.match(name, /^gas_return_test_\d+$/);
    const root = await mysql.createConnection(config);
    let db;
    try {
      await root.query("CREATE DATABASE `" + name + "`");
      db = mysql.createPool({ ...config, database: name, connectionLimit: 5 });
      await db.query(
        "CREATE TABLE users(id INT PRIMARY KEY,name VARCHAR(100))"
      );
      await db.query("INSERT INTO users VALUES(7,'Plant manager')");
      for (const file of [
        "20260927000100_create_gas_bottle_receipts.sql",
        "20260927000200_create_gas_bottles.sql",
        "20260927000300_create_gas_bottle_runs.sql",
        "20260928000200_add_gas_bottle_filled_weight.sql",
        "20260928000300_add_gas_run_empty_weight.sql",
        "20261001000100_add_gas_run_end_reason.sql",
        "20261028000100_create_gas_bottle_returns.sql",
      ])
        await db.query(
          fs.readFileSync(
            path.join(__dirname, "../migrations/versioned", file),
            "utf8"
          )
        );
      await db.query(
        "INSERT INTO gas_bottle_receipts(bottle_count,kg_per_bottle,price_per_bottle,received_at,actor_user_id) VALUES(3,425,42500,'2026-10-01 06:00:00',7)"
      );
      await db.query(
        "INSERT INTO gas_bottles(id,receipt_id,bottle_code,status,position_no,filled_weight_kg) VALUES(1,1,'BOTTLE-1','running',1,525),(2,1,'BOTTLE-2','ready',2,530),(3,1,'BOTTLE-3','filled',NULL,NULL)"
      );
      await db.query(
        "INSERT INTO gas_bottle_runs(id,bottle_id,position_no,started_at,start_gas_kg,started_by) VALUES(1,1,1,'2026-10-01 08:00:00',425,7)"
      );
      // Service production queries return existing fixture measurements only.
      await db.query(
        "CREATE TABLE production_entries(ms_weight DECIMAL(12,3),dipping_qty INT,shift_id INT,shift_date DATE,production_time TIME,row_type VARCHAR(20))"
      );
      await db.query("CREATE TABLE shifts(id INT PRIMARY KEY,start_time TIME)");
      await db.query(
        "INSERT INTO production_entries VALUES(500,2,NULL,'2026-10-01','09:00:00','entry'),(1000,2,NULL,'2026-10-01','10:30:00','entry')"
      );
      const now = DateTime.fromISO("2026-10-02", { zone: "Asia/Kolkata" });
      const b = {
        bottle_id: 2,
        returned_at: "2026-10-01 09:00:00",
        reason: "Not needed in position 2",
        request_key: "unused_return_request_001",
      };
      const first = await returnBottleToStock(db, 2, b, 7, now);
      assert.equal(first.was_used, false);
      const [[unused]] = await db.query("SELECT * FROM gas_bottles WHERE id=2");
      assert.equal(unused.position_no, null);
      assert.equal(unused.status, "filled");
      assert.equal(unused.filled_weight_kg, 530);
      assert.equal(unused.remaining_gas_kg, 425);
      assert.equal((await returnBottleToStock(db, 2, b, 7, now)).id, first.id);
      await assert.rejects(
        returnBottleToStock(db, 2, { ...b, bottle_id: 3 }, 7, now),
        { status: 409 }
      );
      await assert.rejects(
        returnBottleToStock(
          db,
          1,
          {
            ...b,
            bottle_id: 1,
            returned_at: "2026-10-01 10:00:00",
            request_key: "running_blocked_request_001",
          },
          7,
          now
        ),
        { status: 409 }
      );
      const [[stillRunning]] = await db.query(
        "SELECT * FROM gas_bottle_runs WHERE id=1"
      );
      assert.equal(stillRunning.finished_at, null);
      const [[occupied]] = await db.query(
        "SELECT status,position_no FROM gas_bottles WHERE id=1"
      );
      assert.equal(occupied.status, "running");
      assert.equal(occupied.position_no, 1);
      const [[noReturn]] = await db.query(
        "SELECT COUNT(*) n FROM gas_bottle_returns WHERE bottle_id=1"
      );
      assert.equal(noReturn.n, 0);
      // Existing paused/ready stock remains returnable, without changing its recorded run.
      await db.query(
        "UPDATE gas_bottle_runs SET finished_at='2026-10-01 10:00:00',end_reason='paused',production_ton=1,note='Paused for later use' WHERE id=1"
      );
      await db.query("UPDATE gas_bottles SET status='ready' WHERE id=1");
      const runBody = {
        bottle_id: 1,
        returned_at: "2026-10-01 10:00:00",
        reason: "Move to a different slot",
        request_key: "ready_return_request_001",
      };
      const same = await Promise.all([
        returnBottleToStock(db, 1, runBody, 7, now),
        returnBottleToStock(db, 1, runBody, 7, now),
      ]);
      assert.equal(same[0].id, same[1].id);
      assert.equal(same[0].was_used, true);
      let [[run]] = await db.query("SELECT * FROM gas_bottle_runs WHERE id=1");
      assert.equal(run.end_reason, "paused");
      assert.equal(run.production_ton, 1);
      assert.ok(run.finished_at);
      assert.equal(run.consumed_gas_kg, null);
      assert.equal(run.empty_weight_kg, null);
      assert.equal(run.note, "Paused for later use");
      const [[used]] = await db.query("SELECT * FROM gas_bottles WHERE id=1");
      assert.equal(used.position_no, null);
      assert.equal(used.remaining_gas_kg, 425);
      assert.equal(used.filled_weight_kg, 525);
      const [[audits]] = await db.query(
        "SELECT COUNT(*) n FROM gas_bottle_returns"
      );
      assert.equal(audits.n, 2);
      const [[audit]] = await db.query(
        "SELECT * FROM gas_bottle_returns WHERE bottle_id=1"
      );
      assert.ok(JSON.parse(audit.before_data).runs[0].finished_at);
      assert.equal(audit.run_id, null);
      assert.equal(JSON.parse(audit.after_data).position_no, null);
      // Exercise actual controller placement/resume without contacting push services.
      const filename = path.join(
          __dirname,
          "../controllers/gasManagementController.js"
        ),
        realRequire = require("module").createRequire(filename),
        mod = { exports: {} };
      const deps = {
        "../config/db": db,
        "../services/stockAlertService": {
          checkStockAlerts: async () => {},
          GAS_LIMIT_BOTTLES: 4,
        },
      };
      vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
        module: mod,
        require: (n) => deps[n] || realRequire(n),
        console,
        Date,
      });
      const response = () => ({
        status(n) {
          this.code = n;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      });
      let res = response();
      await mod.exports.fillPosition(
        {
          params: { position: 4 },
          body: { bottle_id: 1, filled_weight_kg: 600 },
          user: { id: 7 },
          app: { get: () => null },
        },
        res
      );
      assert.equal(res.code, 400);
      res = response();
      await mod.exports.fillPosition(
        {
          params: { position: 4 },
          body: {
            bottle_id: 1,
            filled_weight_kg: 525,
            started_at: "2026-10-01 11:00:00",
          },
          user: { id: 7 },
          app: { get: () => null },
        },
        res
      );
      assert.equal(res.body.success, true);
      const [[resumed]] = await db.query(
        "SELECT * FROM gas_bottles WHERE id=1"
      );
      assert.equal(resumed.position_no, 4);
      assert.equal(resumed.status, "running");
      const [[count]] = await db.query(
        "SELECT COUNT(*) n FROM gas_bottle_runs WHERE bottle_id=1"
      );
      assert.equal(count.n, 2);
      await assert.rejects(
        returnBottleToStock(
          db,
          4,
          { ...runBody, bottle_id: 2, request_key: "wrong_bottle_request_01" },
          7,
          now
        ),
        { status: 409 }
      );
      [[run]] = await db.query("SELECT * FROM gas_bottle_runs WHERE id=1");
      assert.equal(run.consumed_gas_kg, null);
      await db.query(
        "INSERT INTO production_entries VALUES(1000,2,NULL,'2026-10-01','11:30:00','entry')"
      );
      const call = async (fn, body, position) => {
        const responseObj = response();
        await mod.exports[fn](
          {
            body,
            params: { position },
            user: { id: 7 },
            app: { get: () => null },
          },
          responseObj
        );
        assert.equal(responseObj.body.success, true, responseObj.body.message);
        return responseObj.body;
      };
      await call("fillPosition", { bottle_id: 2, filled_weight_kg: 530 }, 2);
      await call("changeBottle", {
        bottle_number: 2,
        changed_at: "2026-10-01 12:00:00",
      });
      await call(
        "fillPosition",
        { bottle_id: 3, filled_weight_kg: 540, empty_weight_kg: 125 },
        4
      );
      const [[usage]] = await db.query(
        "SELECT SUM(consumed_gas_kg) gas,SUM(consumed_cost) cost,SUM(production_ton) production FROM gas_bottle_runs WHERE bottle_id=1"
      );
      assert.equal(usage.gas, 400);
      assert.equal(usage.cost, 40000);
      assert.equal(
        usage.production,
        3,
        "paused interval production must not be assigned to this bottle"
      );
      await db.query(
        "CREATE TABLE plant_status_history(status VARCHAR(20),started_at DATETIME,ended_at DATETIME)"
      );
      const dash = await call("getDashboard", {});
      assert.equal(dash.data.returns.length, 2);
      assert.equal(dash.data.positions.find((p) => p.position_no === 4).id, 3);
      assert.equal(dash.data.runs.find((r) => r.id === 1).production_ton, 1);
    } finally {
      if (db) await db.end();
      await root.query("DROP DATABASE IF EXISTS `" + name + "`");
      await root.end();
    }
  }
);
