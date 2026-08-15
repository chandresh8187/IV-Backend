const express = require("express");

const authMiddleware = require("../middleware/authMiddleware");

const roleMiddleware = require("../middleware/roleMiddleware");

const {
  getSettings,
  updateSetting,
  getAuditLogs,
} = require("../controllers/settingsController");

const router = express.Router();

const superadminOnly = [
  authMiddleware,
  roleMiddleware(["superadmin"], "settings.manage"),
];

router.get("/audit/logs", ...superadminOnly, getAuditLogs);

router.get("/", ...superadminOnly, getSettings);

router.put("/:key", ...superadminOnly, updateSetting);

module.exports = router;
