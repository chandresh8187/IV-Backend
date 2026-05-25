const express = require("express");
const router = express.Router();

const { loginUser, registerUser } = require("../controllers/authController");

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

router.post("/login", loginUser);

// Only superadmin can register admin/supervisor
router.post(
  "/register",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  registerUser,
);

module.exports = router;
