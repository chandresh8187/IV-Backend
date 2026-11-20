const router = require("express").Router(),
  db = require("../config/unit1Db"),
  access = require("../middleware/roleMiddleware");
const service = require("../services/unit1Planning");
const { positiveId } = require("../services/unit1ProductionValidation");
const { publishUnit1Change } = require("../services/unit1Realtime");
router.get(
  "/templates",
  access([], "unit1.production.view"),
  async (req, res, next) => {
    try {
      res.json({ data: await service.templates(db) });
    } catch (e) {
      next(e);
    }
  }
);
router.get(
  "/templates/:id/pdf",
  access([], "unit1.production.view"),
  async (req, res, next) => {
    try {
      const row = (await service.templates(db)).find(
        (t) => Number(t.id) === positiveId(req.params.id)
      );
      if (!row) return res.status(404).json({ error: "Template not found." });
      const bytes =
        await require("../services/pdf/unit1ProductionPdfGenerator").generateJobCardPdf(
          row
        );
      res
        .set({
          "Content-Type": "application/pdf",
          "Cache-Control": "private, no-store",
        })
        .send(bytes);
    } catch (e) {
      next(e);
    }
  }
);
router.get(
  "/plans",
  access([], "unit1.production.view"),
  async (req, res, next) => {
    try {
      res.json({ data: await service.plans(db) });
    } catch (e) {
      next(e);
    }
  }
);
for (const kind of ["templates", "plans"])
  for (const method of ["post", "put"])
    router[method](
      "/" + kind + (method === "put" ? "/:id" : ""),
      access([], "unit1.jobcards.manage"),
      async (req, res, next) => {
        try {
          const id = method === "put" ? positiveId(req.params.id) : null;
          if (method === "put" && !id)
            return res.status(400).json({ error: "Invalid ID." });
          const result = await (kind === "templates"
            ? service.saveTemplate
            : service.savePlan)(db, id, req.body, req.user.id);
          for (const resource of ["job-cards", "production", "coils"])
            publishUnit1Change(req, resource, { action: "planning_updated" });
          res.status(method === "post" ? 201 : 200).json({ data: result });
        } catch (e) {
          next(e);
        }
      }
    );
for (const kind of ["templates", "plans"])
  router.delete(
    "/" + kind + "/:id",
    access([], "unit1.jobcards.manage"),
    async (req, res, next) => {
      try {
        const id = positiveId(req.params.id);
        if (!id) return res.status(400).json({ error: "Invalid ID." });
        const data = await service.archive(
          db,
          kind,
          id,
          req.user.id,
          req.body?.version
        );
        for (const resource of ["job-cards", "production", "coils"])
          publishUnit1Change(req, resource, { action: "planning_archived" });
        res.json({ data });
      } catch (e) {
        next(e);
      }
    }
  );
module.exports = router;
