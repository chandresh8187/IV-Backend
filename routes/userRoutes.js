const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  getUsers,
  updateUser,
  setUserStatus,
} = require("../controllers/userController");
const {
  getUserPermissions,
  updateUserPermissions,
} = require("../controllers/permissionController");

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "plant_manager", "superadmin"], "users.view"),
  getUsers,
);

router.get(
  "/:id/permissions",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  getUserPermissions,
);

router.put(
  "/:id/permissions",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  updateUserPermissions,
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["superadmin"], "users.manage"),
  updateUser,
);

router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware(["superadmin"], "users.manage"),
  setUserStatus,
);

module.exports = router;
