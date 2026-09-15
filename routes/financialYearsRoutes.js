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
router.put('/:id/current', authMiddleware, roleMiddleware(['superadmin'], 'settings.manage'), setCurrentFinancialYear);
router.post("/", authMiddleware, createFinancialYear);
router.put("/:id", authMiddleware, updateFinancialYear);
router.delete("/:id", authMiddleware, deleteFinancialYear);

module.exports = router;
