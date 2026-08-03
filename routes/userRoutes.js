const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  getUsers,
  updateUser,
  setUserStatus,
} = require("../controllers/userController");

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "plant_manager", "superadmin"]),
  getUsers,
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  updateUser,
);

router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  setUserStatus,
);

module.exports = router;
