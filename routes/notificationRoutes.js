const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  saveFcmToken,
  removeFcmToken,
} = require("../controllers/notificationController");

router.post("/save-token", authMiddleware, saveFcmToken);

router.post("/remove-token", authMiddleware, removeFcmToken);

module.exports = router;
