const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { generateProductionReport } = require("../controllers/productionReportController");

const {
  getHistoryDates,
  getHistoryDateSummary,
  getHistoryShiftTable,
  getHistoryMaterialSummary,
  getHistoryPlanningSummary,
} = require("../controllers/productionHistoryController");

router.get("/dates", authMiddleware, getHistoryDates);

router.get("/date-summary", authMiddleware, getHistoryDateSummary);

router.get("/shift-table", authMiddleware, getHistoryShiftTable);

router.get("/material-summary", authMiddleware, getHistoryMaterialSummary);

router.get("/planning-summary", authMiddleware, getHistoryPlanningSummary);

router.get(
  "/report",
  authMiddleware,
  generateProductionReport,
);

module.exports = router;
