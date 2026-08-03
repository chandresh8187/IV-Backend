const jwt = require("jsonwebtoken");
const db = require("../config/db");

const authMiddleware = async (req, res, next) => {
  const authHeader = String(req.headers.authorization || "");

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  const token = authHeader.slice(7).trim();
  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "iv-api",
      audience: "iv-app",
    });
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  try {
    const [users] = await db.query(
      "SELECT id, role, assigned_shift, status FROM users WHERE id = ? LIMIT 1",
      [decoded.id],
    );

    if (!users.length || users[0].status !== "active") {
      return res.status(401).json({
        success: false,
        message: "Your session is no longer active",
      });
    }

    req.user = {
      id: users[0].id,
      role: String(users[0].role || "").toLowerCase().trim(),
      assigned_shift: users[0].assigned_shift || null,
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = authMiddleware;
