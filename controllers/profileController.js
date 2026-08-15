const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { getUserAccess } = require("../services/permissionService");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const publicUserSelect = `
  SELECT
    id,
    name,
    email,
    role,
    assigned_shift,
    status,
    created_at,
    updated_at
  FROM users
  WHERE id = ?
  LIMIT 1
`;

const withPermissions = async (user) => {
  const access = await getUserAccess({ userId: user.id, role: user.role });
  return { ...user, permissions: access.allowedKeys };
};

const addAuditLog = async ({ actorId, action, metadata, ipAddress }) => {
  await db.query(
    `INSERT INTO audit_logs (
       actor_user_id,
       action,
       entity_type,
       entity_id,
       metadata,
       ip_address
     )
     VALUES (?, ?, 'profile', ?, ?, ?)`,
    [
      actorId,
      action,
      String(actorId),
      JSON.stringify(metadata || {}),
      ipAddress || null,
    ],
  );
};

const getMyProfile = async (req, res) => {
  try {
    const [rows] = await db.query(publicUserSelect, [req.user.id]);

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const user = await withPermissions(rows[0]);

    return res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("getMyProfile:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load profile",
    });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const currentPassword = String(req.body.current_password || "");

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must contain between 2 and 100 characters",
      });
    }

    if (email.length > 190 || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address",
      });
    }

    const [currentRows] = await db.query(
      `SELECT id, name, email, password
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id],
    );

    if (!currentRows.length) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const currentUser = currentRows[0];
    const emailChanged = normalizeEmail(currentUser.email) !== email;

    if (emailChanged) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password is required to change your email",
        });
      }

      const passwordMatches = await bcrypt.compare(
        currentPassword,
        currentUser.password,
      );

      if (!passwordMatches) {
        return res.status(403).json({
          success: false,
          message: "Current password is incorrect",
        });
      }
    }

    const [duplicates] = await db.query(
      `SELECT id
       FROM users
       WHERE email = ? AND id <> ?
       LIMIT 1`,
      [email, req.user.id],
    );

    if (duplicates.length) {
      return res.status(409).json({
        success: false,
        message: "This email address is already registered",
      });
    }

    await db.query(
      `UPDATE users
       SET name = ?, email = ?, updated_at = NOW()
       WHERE id = ?`,
      [name, email, req.user.id],
    );

    await addAuditLog({
      actorId: req.user.id,
      action: "update_profile",
      ipAddress: req.ip,
      metadata: {
        previous: {
          name: currentUser.name,
          email: currentUser.email,
        },
        next: { name, email },
      },
    });

    const [updatedRows] = await db.query(publicUserSelect, [req.user.id]);

    const updatedUser = await withPermissions(updatedRows[0]);

    req.app.get("io")?.to(`user:${req.user.id}`).emit("profile_updated", {
      user: updatedUser,
    });

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("updateMyProfile:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This email address is already registered",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to update profile",
    });
  }
};

const changeMyPassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.current_password || "");
    const newPassword = String(req.body.new_password || "");
    const confirmPassword = String(req.body.confirm_password || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password, new password and confirmation are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New passwords do not match",
      });
    }

    if (
      newPassword.length < 8 ||
      newPassword.length > 72 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be 8-72 characters and include uppercase, lowercase and a number",
      });
    }

    const [rows] = await db.query(
      `SELECT password
       FROM users
       WHERE id = ? AND status = 'active'
       LIMIT 1`,
      [req.user.id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Active profile not found",
      });
    }

    const currentMatches = await bcrypt.compare(
      currentPassword,
      rows[0].password,
    );

    if (!currentMatches) {
      return res.status(403).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const reusesCurrentPassword = await bcrypt.compare(
      newPassword,
      rows[0].password,
    );

    if (reusesCurrentPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from the current password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.query(
      `UPDATE users
       SET password = ?, updated_at = NOW()
       WHERE id = ?`,
      [hashedPassword, req.user.id],
    );

    await addAuditLog({
      actorId: req.user.id,
      action: "change_password",
      ipAddress: req.ip,
      metadata: { changed_at: new Date().toISOString() },
    });

    return res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("changeMyPassword:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to change password",
    });
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
};
