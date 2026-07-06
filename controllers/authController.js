const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
  );
};

// ===============================
// LOGIN USER
// ===============================
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const [users] = await db.query(
      `
      SELECT *
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

    console.log("LOGIN EMAIL:", email);
    console.log("USER FOUND:", users.length);
    console.log("DB PASSWORD:", user?.password);

    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ===============================
// REGISTER USER
// ===============================
const registerUser = async (req, res) => {
  try {
    const { name, email, password, role, assigned_shift } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password and role are required",
      });
    }

    if (!["supervisor", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Superadmin can only register admin or supervisor",
      });
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
      error: error.message,
    });
  }
};

module.exports = {
  loginUser,
  registerUser,
};
