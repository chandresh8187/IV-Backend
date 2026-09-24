const express = require("express");

const {
  createFinancialYear,
  deleteFinancialYear,
  getCurrentFinancialYear,
  getFinancialYears,
  updateFinancialYear,
  setCurrentFinancialYear,
} = require("../controllers/financialYearsController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.get("/", authMiddleware, getFinancialYears);
router.get("/current", authMiddleware, getCurrentFinancialYear);
router.put('/:id/current', authMiddleware, roleMiddleware([], 'financial_years.manage'), setCurrentFinancialYear);
router.post("/", authMiddleware, roleMiddleware([], "financial_years.manage"), createFinancialYear);
router.put("/:id", authMiddleware, roleMiddleware([], "financial_years.manage"), updateFinancialYear);
router.delete("/:id", authMiddleware, roleMiddleware([], "financial_years.manage"), deleteFinancialYear);

module.exports = router;
