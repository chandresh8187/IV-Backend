const express = require("express");

const { loginUser, registerUser, getMyAccess } = require("../controllers/authController");
const {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
} = require("../controllers/profileController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

router.post("/login", loginUser);

router.post(
  "/register",
  authMiddleware,
  roleMiddleware(["superadmin"], "users.manage"),
  registerUser,
);

router.get("/access", authMiddleware, getMyAccess);

// Every authenticated role can manage its own profile.
router.get("/profile", authMiddleware, getMyProfile);
router.put("/profile", authMiddleware, updateMyProfile);
router.put("/change-password", authMiddleware, changeMyPassword);

module.exports = router;
