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
    filename: (req, file, cb) => cb(null, `iv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.apk`),
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.originalname.toLowerCase().endsWith(".apk")),
});

/*
 * Public endpoint.
 *
 * The mobile app must be able to check
 * for native updates before or during
 * login.
 */
router.get("/android", getAndroidUpdate);

/*
 * Only superadmin can update the
 * Android release configuration.
 */
router.put(
  "/android",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  updateAndroidRelease,
);

router.post(
  "/android/upload",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  upload.single("apk"),
  uploadAndroidRelease,
);

module.exports = router;
