const db = require("../config/db");
const crypto = require("crypto");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const EMPTY_ANDROID_RELEASE = {
  enabled: false,
  latestVersionCode: 0,
  latestVersionName: "",
  minimumVersionCode: 0,
  mandatory: false,
  apkUrl: "",
  sha256: "",
  releaseNotes: "",
  updatedAt: null,
};

const mapRelease = (row) =>
  row
    ? {
        enabled: Boolean(row.enabled),
        latestVersionCode: Number(row.latest_version_code) || 0,
        latestVersionName: row.latest_version_name || "",
        minimumVersionCode: Number(row.minimum_version_code) || 0,
        mandatory: Boolean(row.mandatory),
        apkUrl: row.apk_url || "",
        sha256: row.sha256 || "",
        releaseNotes: row.release_notes || "",
        updatedAt: row.updated_at,
      }
    : { ...EMPTY_ANDROID_RELEASE };

const getAndroidUpdate = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM app_update_releases WHERE platform = 'android' LIMIT 1",
    );
    // Intentionally public: the Android app checks this before/login and on startup.
    return res.json({ success: true, ...mapRelease(rows[0]) });
  } catch (error) {
    console.error("getAndroidUpdate:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load Android update settings",
    });
  }
};

const updateAndroidRelease = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const enabled = Boolean(req.body.enabled);
    const latestVersionCode = Number(req.body.latestVersionCode);
    const minimumVersionCode = Number(req.body.minimumVersionCode);
    const latestVersionName = String(req.body.latestVersionName || "").trim();
    const apkUrl = String(req.body.apkUrl || "").trim();
    const sha256 = String(req.body.sha256 || "")
      .trim()
      .toLowerCase();
    const releaseNotes = String(req.body.releaseNotes || "").trim();
    const mandatory = Boolean(req.body.mandatory);

    if (
      !Number.isInteger(latestVersionCode) ||
      latestVersionCode < 1 ||
      !latestVersionName
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid version name and version code are required",
      });
    }
    if (
      !Number.isInteger(minimumVersionCode) ||
      minimumVersionCode < 0 ||
      minimumVersionCode > latestVersionCode
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum version code must be between 0 and the latest version code",
      });
    }
    if (enabled && !/^https:\/\//i.test(apkUrl)) {
      return res
        .status(400)
        .json({ success: false, message: "An HTTPS APK URL is required" });
    }
    if (enabled && !/^[a-f0-9]{64}$/.test(sha256)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "A valid 64-character SHA-256 is required",
        });
    }
    if (releaseNotes.length > 5000) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Release notes cannot exceed 5000 characters",
        });
    }

    await connection.beginTransaction();
    const [beforeRows] = await connection.query(
      "SELECT * FROM app_update_releases WHERE platform = 'android' LIMIT 1 FOR UPDATE",
    );
    const previous = mapRelease(beforeRows[0]);

    await connection.query(
      `INSERT INTO app_update_releases
       (platform, enabled, latest_version_code, latest_version_name,
        minimum_version_code, mandatory, apk_url, sha256, release_notes, updated_by)
       VALUES ('android', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         latest_version_code = VALUES(latest_version_code),
         latest_version_name = VALUES(latest_version_name),
         minimum_version_code = VALUES(minimum_version_code),
         mandatory = VALUES(mandatory), apk_url = VALUES(apk_url),
         sha256 = VALUES(sha256), release_notes = VALUES(release_notes),
         updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
      [
        enabled,
        latestVersionCode,
        latestVersionName,
        minimumVersionCode,
        mandatory,
        apkUrl || null,
        sha256 || null,
        releaseNotes,
        req.user.id,
      ],
    );
    const [afterRows] = await connection.query(
      "SELECT * FROM app_update_releases WHERE platform = 'android' LIMIT 1",
    );
    const data = mapRelease(afterRows[0]);

    await connection.query(
      `INSERT INTO audit_logs
       (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, 'update', 'app_update', 'android', ?, ?)`,
      [req.user.id, JSON.stringify({ previous, next: data }), req.ip],
    );
    await connection.commit();

    req.app.get("io")?.emit("app_update_configuration_changed", data);
    return res.json({
      success: true,
      message: "Android update configuration saved",
      data,
    });
  } catch (error) {
    await connection.rollback();
    console.error("updateAndroidRelease:", error);
    return res.status(500).json({
      success: false,
      message: "Could not save Android update settings",
    });
  } finally {
    connection.release();
  }
};

const uploadAndroidRelease = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Release APK is required" });
  try {
    const sha256 = await new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(req.file.path);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
    const publicBase = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    return res.status(201).json({
      success: true,
      message: "Release APK uploaded successfully",
      data: {
        apkUrl: `${publicBase}/downloads/apks/${req.file.filename}`,
        sha256,
        fileSize: req.file.size,
        originalName: req.file.originalname,
      },
    });
  } catch (error) {
    console.error("uploadAndroidRelease:", error);
    return res.status(500).json({ success: false, message: "Could not process release APK" });
  }
};

const triggerOtaUpdate = async (req, res) => {
  const configuredPasscode = String(process.env.OTA_UPDATE_PASSCODE || "");
  const suppliedPasscode = String(req.body?.passcode || "");
  let valid = false;

  if (configuredPasscode) {
    const expected = Buffer.from(configuredPasscode);
    const supplied = Buffer.from(suppliedPasscode);
    valid = expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  } else {
    const [users] = await db.query(
      "SELECT password FROM users WHERE id = ? AND role = 'superadmin' AND status = 'active' LIMIT 1",
      [req.user.id],
    );
    valid = users.length > 0 && await bcrypt.compare(suppliedPasscode, users[0].password);
  }

  if (!valid) {
    return res.status(403).json({ success: false, message: "Invalid OTA passcode" });
  }

  const requestId = crypto.randomUUID();
  const io = req.app.get("io");
  io?.emit("ota_update_requested", {
    request_id: requestId,
    requested_at: new Date().toISOString(),
  });

  return res.json({
    success: true,
    message: "Connected app devices were asked to download the latest EAS update",
    data: { request_id: requestId, connected_clients: io?.engine?.clientsCount || 0 },
  });
};

module.exports = { getAndroidUpdate, updateAndroidRelease, uploadAndroidRelease, triggerOtaUpdate };
