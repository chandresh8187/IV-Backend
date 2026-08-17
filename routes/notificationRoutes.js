const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  saveFcmToken,
  removeFcmToken,
  getMyNotificationStatus,
  scheduleMyBackgroundTest,
  sendTestNotification,
  testLatestProductionZinc,
} = require("../controllers/notificationController");

router.post("/save-token", authMiddleware, saveFcmToken);

router.post("/remove-token", authMiddleware, removeFcmToken);

router.get("/status", authMiddleware, getMyNotificationStatus);

router.post(
  "/test-background",
  authMiddleware,
  scheduleMyBackgroundTest,
);

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
