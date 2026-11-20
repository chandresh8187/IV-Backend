const router = require("express").Router();
const db = require("../config/unit1Db");
const auth = require("../middleware/unit1AuthMiddleware");
const access = require("../middleware/roleMiddleware");
const service = require("../services/unit1Maintenance");
const { maintenancePdf } = require("../services/unit1MaintenancePdf");
const { publishUnit1Change } = require("../services/unit1Realtime");
router.use(auth);
const allow = (key) => access([], `unit1.maintenance.${key}`);
async function snapshot(work) {
  const c = await db.getConnection();
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await c.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const data = await work(c);
    await c.commit();
    return data;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
router.post("/start", allow("record"), async (req, res, next) => {
  try {
    const data =
      await require("../services/unit1MaintenanceSessions").startMaintenance(
        db,
        req.body,
        req.user.id
      );
    publishUnit1Change(req, "maintenance", {
      action: "started",
      machineId: data.machine_id,
    });
    publishUnit1Change(req, "machines", { machineId: data.machine_id });
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});
router.post("/sessions/:id/done", allow("record"), async (req, res, next) => {
  try {
    const data =
      await require("../services/unit1MaintenanceSessions").finishMaintenance(
        db,
        req.params.id,
        req.body,
        req.user.id
      );
    publishUnit1Change(req, "maintenance", {
      action: "completed",
      machineId: data.machine_id,
    });
    publishUnit1Change(req, "machines", { machineId: data.machine_id });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
router.get("/", allow("view"), async (_req, res, next) => {
  try {
    res.json({ data: await snapshot((c) => service.overview(c)) });
  } catch (e) {
    next(e);
  }
});
router.get("/history", allow("view"), async (req, res, next) => {
  try {
    res.json({ data: await snapshot((c) => service.history(c, req.query)) });
  } catch (e) {
    next(e);
  }
});
router.get("/pdf", allow("view"), async (req, res, next) => {
  try {
    const kind = req.query.kind === "schedule" ? "schedule" : "history";
    const data = await snapshot((c) =>
      kind === "schedule"
        ? service.overview(c)
        : service.history(c, req.query, true)
    );
    if (kind === "schedule") {
      if (req.query.machine_id && !/^\d+$/.test(req.query.machine_id))
        return res.status(400).json({ error: "Invalid machine filter." });
      data.plans = data.plans.filter(
        (p) =>
          (!req.query.machine_id ||
            String(p.machine_id) === String(req.query.machine_id)) &&
          (!req.query.status || p.status === req.query.status)
      );
      data.unscheduled = data.unscheduled.filter(
        (m) =>
          !req.query.machine_id || String(m.id) === String(req.query.machine_id)
      );
      data.summary = Object.fromEntries(
        ["overdue", "due_today", "due_soon", "upcoming", "paused"].map((s) => [
          s,
          data.plans.filter((p) => p.status === s).length,
        ])
      );
      data.summary.unscheduled = data.unscheduled.length;
      data.filters = {
        machine_id: req.query.machine_id,
        status: req.query.status,
      };
    }
    const bytes = await maintenancePdf(data, kind);
    res
      .set({
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="unit1-maintenance-${kind}.pdf"`,
      })
      .send(bytes);
  } catch (e) {
    next(e);
  }
});
router.get("/audit/:kind/:id", allow("manage"), async (req, res, next) => {
  try {
    if (
      !["plans", "records", "sessions"].includes(req.params.kind) ||
      !/^\d+$/.test(req.params.id)
    )
      return res.status(400).json({ error: "Invalid audit record." });
    const [rows] = await db.query(
      "SELECT r.*,u.name actor_name FROM unit1_maintenance_revisions r LEFT JOIN users u ON u.id=r.actor_user_id WHERE entity_type=? AND entity_id=? ORDER BY r.id",
      [req.params.kind, req.params.id]
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});
for (const kind of ["plans", "records"]) {
  router.post(
    `/${kind}`,
    allow(kind === "plans" ? "manage" : "record"),
    async (req, res, next) => {
      try {
        const data = await service.mutate(
          db,
          kind,
          null,
          req.body,
          req.user.id
        );
        publishUnit1Change(req, "maintenance", {
          action: "created",
          kind,
          id: data.id,
        });
        res.status(201).json({ data });
      } catch (e) {
        next(e);
      }
    }
  );
  router.put(`/${kind}/:id`, allow("manage"), async (req, res, next) => {
    try {
      const data = await service.mutate(
        db,
        kind,
        req.params.id,
        req.body,
        req.user.id
      );
      publishUnit1Change(req, "maintenance", {
        action: "updated",
        kind,
        id: data.id,
      });
      res.json({ data });
    } catch (e) {
      next(e);
    }
  });
}
router.post("/records/:id/void", allow("manage"), async (req, res, next) => {
  try {
    const data = await service.mutate(
      db,
      "records",
      req.params.id,
      req.body,
      req.user.id,
      true
    );
    publishUnit1Change(req, "maintenance", { action: "voided", id: data.id });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
module.exports = router;
