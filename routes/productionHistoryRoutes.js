const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { generateProductionReport } = require("../controllers/productionReportController");

const {
  getHistoryDates,
  getHistoryDateSummary,
  getHistoryShiftTable,
  getHistoryMaterialSummary,
  getHistoryPlanningSummary,
} = require("../controllers/productionHistoryController");

const historyViewAccess = roleMiddleware(
  ["supervisor", "admin", "plant_manager", "superadmin"],
  "history.view",
);

router.get("/dates", authMiddleware, historyViewAccess, getHistoryDates);

router.get("/date-summary", authMiddleware, historyViewAccess, getHistoryDateSummary);

router.get("/shift-table", authMiddleware, historyViewAccess, getHistoryShiftTable);

router.get("/material-summary", authMiddleware, historyViewAccess, getHistoryMaterialSummary);

router.get("/planning-summary", authMiddleware, historyViewAccess, getHistoryPlanningSummary);

router.get(
  "/report",
  authMiddleware,
  roleMiddleware(["superadmin"], "reports.generate"),
  generateProductionReport,
);

module.exports = router;
