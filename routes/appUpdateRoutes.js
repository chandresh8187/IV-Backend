const express = require("express");

const authMiddleware = require("../middleware/authMiddleware");

const roleMiddleware = require("../middleware/roleMiddleware");

const {
  getAndroidUpdate,
  updateAndroidRelease,
} = require("../controllers/appUpdateController");

const router = express.Router();

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

module.exports = router;
