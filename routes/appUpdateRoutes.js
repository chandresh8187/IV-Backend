const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const {
  getAndroidUpdate,
  updateAndroidRelease,
  uploadAndroidRelease,
} = require("../controllers/appUpdateController");

const router = express.Router();
const apkDirectory = path.join(__dirname, "../uploads/apks");
fs.mkdirSync(apkDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: apkDirectory,
    filename: (req, file, callback) =>
      callback(
        null,
        `iv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.apk`,
      ),
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, callback) =>
    callback(null, file.originalname.toLowerCase().endsWith(".apk")),
});

// Public so the app can check for a native update before or during login.
router.get("/android", getAndroidUpdate);

router.put(
  "/android",
  authMiddleware,
  roleMiddleware(["superadmin"], "app_updates.manage"),
  updateAndroidRelease,
);

router.post(
  "/android/upload",
  authMiddleware,
  roleMiddleware(["superadmin"], "app_updates.manage"),
  upload.single("apk"),
  uploadAndroidRelease,
);

module.exports = router;
