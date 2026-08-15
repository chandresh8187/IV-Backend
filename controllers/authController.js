const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { getUserAccess } = require("../services/permissionService");

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      issuer: "iv-api",
      audience: "iv-app",
    },
  );
};

// ===============================
// LOGIN USER
// ===============================
const loginUser = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const [users] = await db.query(
      `
      SELECT id, name, email, password, role, assigned_shift, status
      FROM users
      WHERE email = ?
      LIMIT 1
      `,
      [email],
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = users[0];

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Contact superadmin.",
      });
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateToken(user);
    const access = await getUserAccess({ userId: user.id, role: user.role });

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        assigned_shift: user.assigned_shift,
        permissions: access.allowedKeys,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getMyAccess = async (req, res) => {
  try {
    const access = await getUserAccess({
      userId: req.user.id,
      role: req.user.role,
    });
    return res.json({
      success: true,
      data: {
        ...access,
        user: {
          id: req.user.id,
          role: req.user.role,
          assigned_shift: req.user.assigned_shift,
        },
      },
    });
  } catch (error) {
    console.error("getMyAccess:", error);
    return res.status(500).json({ success: false, message: "Could not load your access" });
  }
};

// ===============================
// REGISTER USER
// ===============================
const registerUser = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = String(req.body.role || "").trim().toLowerCase();
    const assigned_shift = String(req.body.assigned_shift || "")
      .trim()
      .toLowerCase();

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password and role are required",
      });
    }

    if (!["superadmin", "supervisor", "admin", "plant_manager"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported account role",
      });
    }

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must contain between 2 and 100 characters",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address",
      });
    }

    if (
      password.length < 8 ||
      password.length > 72 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be 8-72 characters and include uppercase, lowercase and a number",
      });
    }

    if (role === "superadmin") {
      if (req.user.role !== "superadmin") {
        return res.status(403).json({
          success: false,
          message: "Only a Superadmin can create another Superadmin",
        });
      }

      const currentPassword = String(req.body.current_password || "");
      const [actors] = await db.query(
        "SELECT password FROM users WHERE id = ? AND status = 'active' LIMIT 1",
        [req.user.id],
      );
      const verified =
        actors.length > 0 &&
        (await bcrypt.compare(currentPassword, actors[0].password));

      if (!verified) {
        return res.status(403).json({
          success: false,
          message: "Your current password is required to create a Superadmin",
        });
      }
    }

    let finalAssignedShift = null;

    if (role === "supervisor") {
      if (
        !assigned_shift ||
        !["day", "night", "both"].includes(assigned_shift)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "assigned_shift is required for supervisor: day, night or both",
        });
      }

      finalAssignedShift = assigned_shift;
    }

    const [existingUser] = await db.query(
      `
      SELECT id
      FROM users
      WHERE email = ?
      LIMIT 1
      `,
      [email],
    );

    if (existingUser.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `
      INSERT INTO users
      (
        name,
        email,
        password,
        role,
        assigned_shift,
        status,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, 'active', ?)
      `,
      [name, email, hashedPassword, role, finalAssignedShift, req.user.id],
    );

    req.app.get("io")?.emit("users_updated", {
      action: "created",
      user_id: result.insertId,
    });

    return res.status(201).json({
      success: true,
      message: `${role} registered successfully`,
      data: {
        user_id: result.insertId,
        name,
        email,
        role,
        assigned_shift: finalAssignedShift,
        status: "active",
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  loginUser,
  registerUser,
  getMyAccess,
};
