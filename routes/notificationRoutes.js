const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  saveFcmToken,
  removeFcmToken,
  sendTestNotification,
  testLatestProductionZinc,
} = require("../controllers/notificationController");

router.post("/save-token", authMiddleware, saveFcmToken);

router.post("/remove-token", authMiddleware, removeFcmToken);

router.post(
  "/test",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  sendTestNotification,
);

router.post(
  "/test-zinc",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  testLatestProductionZinc,
);

module.exports = router;
