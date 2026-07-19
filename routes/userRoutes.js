const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const { getUsers } = require("../controllers/userController");

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "plant_manager", "superadmin"]),
  getUsers,
);

module.exports = router;
