const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  vm = require("vm");
const { createRequire } = require("module");
const service = require("../services/unit1Planning");
const spec = {
  structureType: "solar_mounting_structure",
  memberName: "Column",
  sectionSize: "100",
  cutLengthMm: 1000,
  materialType: "MS",
  coilWidthMm: 100,
  coilThicknessMm: 1,
  punchSize: "10",
  holes: [{ punchName: "E", profile: "web", punchSize: "10", targetMm: 20 }],
};
test("material templates contain specifications only and plans validate multiple material quantities", () => {
  const material = service.material({
    ...spec,
    customerName: "Excluded",
    productionQty: 999,
  });
  assert.equal(material.customerName, undefined);
  assert.equal(material.productionQty, undefined);
  const body = {
    partyName: "Test",
    projectName: "",
    planDate: "2026-10-29",
    shift: "day",
    lines: [
      { templateId: 1, machineId: 1, quantity: 64, selectedCoils:[{coilId:1,coilNumber:1}] },
      { templateId: 2, machineId: 2, quantity: 30, selectedCoils:[{coilId:1,coilNumber:2}] },
    ],
  };
  assert.equal(service.planInput(body).lines.length, 2);
  assert.throws(
    () =>
      service.planInput({
        ...body,
        lines: [{ templateId: 1, machineId: 1, quantity: 0 }],
      }),
    { status: 400 }
  );
  assert.throws(
    () =>
      service.material({
        ...spec,
        holes: [{ profile: "web", targetMm: 1001 }],
      }),
    { status: 400 }
  );
});
test(
  "multi-material planning preserves production and inspection quantities, propagates audited template corrections and migrates legacy references",
  { skip: process.env.UNIT1_PLANNING_DB_TEST !== "1" },
  async () => {
    const mysql = require("mysql2/promise"),
      name = "unit1_planning_test_" + Date.now();
    assert.match(name, /^unit1_planning_test_\d+$/);
    require('dotenv-flow').config({silent:true});
    assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));
    const root = await mysql.createConnection({
      host: process.env.UNIT1_DB_HOST||process.env.DB_HOST,
      port: Number(process.env.UNIT1_DB_PORT||process.env.DB_PORT)||3306,
      user: process.env.UNIT1_DB_USER||process.env.DB_USER,
      password: process.env.UNIT1_DB_PASSWORD??process.env.DB_PASSWORD,
    });
    let db;
    try {
      await root.query(
        "CREATE DATABASE `" +
          name +
          "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
      );
      const sql = fs
        .readFileSync(
          path.join(
            __dirname,
            "../database/u436685010_iv1_app_clean_install.sql"
          ),
          "utf8"
        )
        .replace(/^--.*$/gm, "")
        .replace("USE `u436685010_iv1_app`", "USE `" + name + "`");
      for (const statement of sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((s) => s.trim())
        .filter(Boolean))
        await root.query(statement);
      db = mysql.createPool({
        host: process.env.UNIT1_DB_HOST||process.env.DB_HOST,
        port: Number(process.env.UNIT1_DB_PORT||process.env.DB_PORT)||3306,
        user: process.env.UNIT1_DB_USER||process.env.DB_USER,
        password: process.env.UNIT1_DB_PASSWORD??process.env.DB_PASSWORD,
        database: name,
        decimalNumbers: true,
        timezone: "+05:30",
      });
      db.on("connection", (c) => c.query("SET time_zone='+05:30'"));
      const migrationFile = path.join(
          __dirname,
          "../scripts/migrateUnit1Coils.js"
        ),
        migrationRequire = createRequire(migrationFile),
        migrationModule = { exports: {} };
      vm.runInNewContext(fs.readFileSync(migrationFile, "utf8"), {
        module: migrationModule,
        console,
        process,
        require: (n) => (n === "../config/unit1Db" ? db : migrationRequire(n)),
      });
      await migrationModule.exports.migrateUnit1Coils();

      await db.query(
        "INSERT INTO unit1_machines(id,code,name,is_active) VALUES(1,'TEST1','Former',1),(2,'TEST2','Punch',1)"
      );
      await db.query(
        "INSERT INTO coils(id,internal_id,supplier_coil_id,supplier,invoice,grade,material_type,thickness_mm,width_mm,coil_qty,gross_kg,tare_kg,estimated_kg,actual_net_kg,status,qr_generated_at) VALUES(1,'TEST-COIL','TEST-SUPPLIER','S','I','E250','MS',1,100,3,3000,0,3000,3000,'in_stock',UTC_TIMESTAMP(3))"
      );
      const first = await service.saveTemplate(
          db,
          null,
          { ...spec, name: "Column" },
          1
        ),
        second = await service.saveTemplate(
          db,
          null,
          { ...spec, memberName: "Rafter", name: "Rafter" },
          1
        );
      const input = {
        partyName: "Test",
        projectName: "",
        planDate: "2026-10-29",
        shift: "day",
        requestKey: "planning_test_request_001",
        lines: [
          {
            templateId: first.id,
            machineId: 1,
            quantity: 64,
            selectedCoils: [{ coilId: 1, coilNumber: 1 }],
          },
          {
            templateId: second.id,
            machineId: 2,
            quantity: 30,
            selectedCoils: [{ coilId: 1, coilNumber: 2 }],
          },
        ],
      };
      const plan = await service.savePlan(db, null, input, 1);
      assert.equal((await service.savePlan(db, null, input, 1)).id, plan.id);
      let list = await service.plans(db);
      assert.equal(list.length, 1);
      assert.equal(list[0].lines.length, 2);
      const line = list[0].lines.find(
        (l) => Number(l.templateId) === Number(first.id)
      );
      assert.equal(line.quantity, 64);
      assert.equal(line.producedPieces, 0);
      const { startJobRun } = require("../services/unit1StartJobRun");
      await assert.rejects(
        service.transaction(db, (c) =>
          startJobRun(
            c,
            {
              jobCardId: line.id,
              coilId: 1,
              coilNumber: 1,
              machineId: 2,
              canAssignJob: false,
            },
            1
          )
        ),
        { status: 409 }
      );
      const runId = await service.transaction(db, (c) =>
        startJobRun(
          c,
          {
            jobCardId: line.id,
            coilId: 1,
            coilNumber: 1,
            machineId: 1,
            canAssignJob: false,
          },
          1
        )
      );
      const filename = path.join(
          __dirname,
          "../routes/unit1ProductionRoutes.js"
        ),
        realRequire = createRequire(filename),
        mod = { exports: {} };
      const shift = realRequire("../services/unit1ShiftService");
      vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
        module: mod,
        console,
        process,
        require: (n) =>
          n === "../config/unit1Db"
            ? db
            : n === "../services/unit1ShiftService"
            ? { ...shift, getSchedule: () => shift.getSchedule(db) }
            : ["./unit1JobCardRoutes", "./unit1PlanningRoutes"].includes(n)
            ? require("express").Router()
            : realRequire(n),
      });
      async function call(route, body) {
        const layer = mod.exports.stack.find(
          (l) => l.route?.path === route && l.route.methods.post
        );
        assert.ok(layer, route);
        const req = {
            params: { id: String(runId) },
            body,
            user: { id: 1, role: "superadmin" },
            app: { get: () => null },
          },
          res = {
            status() {
              return this;
            },
            json(value) {
              this.body = value;
              return this;
            },
          };
        let error;
        await layer.route.stack.at(-1).handle(req, res, (e) => {
          error = e;
        });
        if (error) throw error;
        return res.body;
      }
      const original = await service.job(db, line.id);
      assert.equal(original.holes[0].punchName,"E");
      await call("/runs/:id/hole-check", {
        approved: true,
        measuredCutLengthMm: 1000,
        measuredSectionSize: "100",
        measurements: [{ holeId: original.holes[0].id, measuredMm: 20.1 }],
        requestKey: "planning_inspection_001",
      });
      await call("/runs/:id/bundles", { pieces: 64 });
      const [[stock]] = await db.query(
        "SELECT SUM(m.quantity) qty FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE i.customer_name='Test'"
      );
      assert.equal(Number(stock.qty), 64);
      await service.saveTemplate(
        db,
        first.id,
        { ...spec, holes:spec.holes.map(h=>({...h,punchName:"B"})), name: "Column revised", version: 1, cutLengthMm: 1100 },
        1
      );
      const [[run]] = await db.query(
        "SELECT status,produced_pieces,hole_checked_at FROM unit1_production_runs WHERE id=?",
        [runId]
      );
      assert.equal(run.status, "setup");
      assert.equal(run.produced_pieces, 64);
      assert.equal(run.hole_checked_at, null);
      const [[reading]] = await db.query(
        "SELECT measured_mm FROM unit1_hole_check_measurements LIMIT 1"
      );
      assert.equal(Number(reading.measured_mm), 20.1);
      assert.equal((await service.job(db,line.id)).holes[0].punchName,"B");
      const [[savedCheck]]=await db.query("SELECT report_snapshot FROM unit1_hole_checks LIMIT 1");
      const savedReading=JSON.parse(savedCheck.report_snapshot).measurements[0];
      assert.equal(savedReading.punchLetter,"B");assert.equal(savedReading.originalPunchName,"E");assert.equal(savedReading.measuredMm,20.1);
      const [[stockAfter]] = await db.query(
        "SELECT SUM(m.quantity) qty,MAX(i.length_mm) length FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE i.customer_name='Test' AND m.quantity>0"
      );
      assert.equal(Number(stockAfter.qty), 64);
      assert.equal(Number(stockAfter.length), 1100);
      list = await service.plans(db);
      assert.equal(
        Number(
          list[0].lines.find((l) => Number(l.id) === Number(line.id))
            .cutLengthMm
        ),
        1100
      );
      const [[link]] = await db.query(
        "SELECT original_input FROM unit1_production_plan_lines WHERE job_card_id=?",
        [line.id]
      );
      assert.equal(
        JSON.parse(link.original_input).specification.cutLengthMm,
        1000
      );
      await assert.rejects(
        service.saveTemplate(db, first.id, { ...spec, version: 1 }, 1),
        { status: 409 }
      );
      const edit = {
        ...list[0],
        partyName: "Corrected party",
        lines: list[0].lines.map((l) => ({
          ...l,
          quantity: Number(l.id) === Number(line.id) ? 63 : l.quantity,
        })),
      };
      await assert.rejects(service.savePlan(db, plan.id, edit, 1), {
        status: 409,
      });
      assert.equal((await service.plans(db))[0].partyName, "Test");
      edit.lines = edit.lines.map((l) => ({
        ...l,
        quantity: Number(l.id) === Number(line.id) ? 70 : l.quantity,
      }));
      await service.savePlan(db, plan.id, edit, 1);
      const [[corrected]] = await db.query(
        "SELECT SUM(m.quantity) qty FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE i.customer_name='Corrected party'"
      );
      assert.equal(Number(corrected.qty), 64);
      const [legacy] = await db.query(
        "INSERT INTO unit1_job_cards(job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by) SELECT job_date,'Legacy party',project_name_capacity,20,structure_type,member_name,section_size,shift,cut_length_mm,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by FROM unit1_job_cards WHERE id=?",
        [line.id]
      );
      await db.query(
        "INSERT INTO unit1_job_card_holes(job_card_id,sequence_no,profile,punch_size,target_mm) VALUES(?,1,'web','10',20)",
        [legacy.insertId]
      );
      const {
        migrateUnit1Planning,
      } = require("../scripts/migrateUnit1Planning");
      await migrateUnit1Planning(db);
      await migrateUnit1Planning(db);
      list = await service.plans(db);
      assert.equal(list.length, 2);
      assert.equal(
        list.find((p) => p.partyName === "Legacy party").lines[0].id,
        legacy.insertId
      );
      assert.equal(
        list.find((p) => p.partyName === "Legacy party").lines[0].quantity,
        20
      );

      const current = (await service.plans(db)).find(
        (p) => Number(p.id) === Number(plan.id)
      );
      await assert.rejects(
        service.archive(db, "plans", plan.id, 1, current.version),
        { status: 409 }
      );
      assert.ok(
        (await service.plans(db)).some((p) => Number(p.id) === Number(plan.id))
      );
      await service.archive(db, "templates", first.id, 1, 2);
      assert.ok(
        !(await service.templates(db)).some(
          (t) => Number(t.id) === Number(first.id)
        )
      );
      await assert.rejects(
        service.savePlan(
          db,
          null,
          { ...input, requestKey: "planning_archived_template_001" },
          1
        ),
        { status: 409 }
      );
      await service.savePlan(
        db,
        plan.id,
        { ...current, projectName: "Existing plan still editable" },
        1
      );
      const updated = await service.job(db, line.id);
      await call("/runs/:id/hole-check", {
        approved: true,
        measuredCutLengthMm: 1100,
        measuredSectionSize: "100",
        measurements: [{ holeId: updated.holes[0].id, measuredMm: 20.2 }],
        requestKey: "planning_inspection_002",
      });
      await call("/runs/:id/return-coil", {});
      const finalPlan = (await service.plans(db)).find(
        (p) => Number(p.id) === Number(plan.id)
      );
      await service.archive(db, "plans", plan.id, 1, finalPlan.version);
      assert.ok(
        !(await service.plans(db)).some((p) => Number(p.id) === Number(plan.id))
      );
      const [[retained]] = await db.query(
        "SELECT produced_pieces FROM unit1_production_runs WHERE id=?",
        [runId]
      );
      assert.equal(Number(retained.produced_pieces), 64);
      const [[stockRetained]] = await db.query(
        "SELECT SUM(m.quantity) qty FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE i.customer_name='Corrected party'"
      );
      assert.equal(Number(stockRetained.qty), 64);
      const [[archived]] = await db.query(
        "SELECT archived_at FROM unit1_job_cards WHERE id=?",
        [line.id]
      );
      assert.ok(archived.archived_at);
      await service.archive(db, "plans", plan.id, 1, finalPlan.version);
      const [[audit]] = await db.query(
        "SELECT COUNT(*) n FROM unit1_planning_revisions WHERE entity_type='plan' AND entity_id=?",
        [plan.id]
      );
      assert.ok(audit.n >= 3);
      await migrateUnit1Planning(db);
      assert.ok(
        !(await service.plans(db)).some((p) => Number(p.id) === Number(plan.id))
      );
      assert.ok(
        !(await service.templates(db)).some(
          (t) => Number(t.id) === Number(first.id)
        )
      );
      const [[recordedDate]] = await db.query(
        "SELECT DATE_FORMAT(COALESCE(shift_date,DATE(created_at)),'%Y-%m-%d') day FROM unit1_production_bundles LIMIT 1"
      );
      const report =
        await require("../services/unit1ProductionReport").productionReport(
          db,
          { date: recordedDate.day }
        );
      assert.equal(report.entries.length, 1);
      assert.equal(Number(report.entries[0].planningId), Number(plan.id));
      assert.equal(Number(report.entries[0].templateId), Number(first.id));
      assert.equal(report.entries[0].pieces, 64);
      assert.equal(report.entries[0].customerName, "Corrected party");
    const partyService=require('../services/unit1PartyMaterial');
    const party=await partyService.getParty(db,partyService.partyKey('Corrected party'));
    assert.equal(Number(party.sources[0].planningId),Number(plan.id));
    assert.equal(Number(party.sources[0].templateId),Number(first.id));

    } finally {
      if (db) await db.end();
      await root.query("DROP DATABASE IF EXISTS `" + name + "`");
      await root.end();
    }
  }
);
