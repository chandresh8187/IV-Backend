const db = require("../config/db");

const VALID_STATUSES = ["running", "maintenance", "stopped"];

const getPlantStatusRow = async (executor = db) => {
  const [rows] = await executor.query(
    `
    SELECT
      ps.*,
      u.name AS updated_by_name,
      u.role AS updated_by_role
    FROM plant_status ps
    LEFT JOIN users u ON u.id = ps.updated_by
    WHERE ps.id = 1
    LIMIT 1
    `,
  );

  return rows[0] || null;
};

const serializeStatus = (row) => ({
  id: row.id,
  status: row.status,
  title: row.title,
  message: row.message,
  started_at: row.started_at,
  expected_restart_at: row.expected_restart_at,
  updated_at: row.updated_at,
  production_allowed: row.status === "running",
  updated_by: row.updated_by
    ? {
        id: row.updated_by,
        name: row.updated_by_name,
        role: row.updated_by_role,
      }
    : null,
});

const getPlantStatus = async (req, res) => {
  try {
    const status = await getPlantStatusRow();

    if (!status) {
      return res.status(404).json({
        success: false,
        message: "Plant status record not found. Insert row id = 1 first.",
      });
    }

    return res.json({ success: true, data: serializeStatus(status) });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to get plant status",
      error: error.message,
    });
  }
};

const changePlantStatus = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { status, title, message, expected_restart_at = null } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be running, maintenance or stopped",
      });
    }

    if (status !== "running" && (!title?.trim() || !message?.trim())) {
      return res.status(400).json({
        success: false,
        message: "title and message are required",
      });
    }

    await connection.beginTransaction();

    const [currentRows] = await connection.query(
      `SELECT * FROM plant_status WHERE id = 1 FOR UPDATE`,
    );

    if (!currentRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Plant status record not found",
      });
    }

    const current = currentRows[0];

    if (["maintenance", "stopped"].includes(current.status)) {
      await connection.query(
        `
        UPDATE plant_status_history
        SET ended_at = NOW(), ended_by = ?
        WHERE ended_at IS NULL AND status = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [req.user.id, current.status],
      );
    }

    if (status === "running") {
      await connection.query(
        `
        UPDATE plant_status
        SET status = 'running', title = NULL, message = NULL,
            started_at = NOW(), expected_restart_at = NULL, updated_by = ?
        WHERE id = 1
        `,
        [req.user.id],
      );
    } else {
      await connection.query(
        `
        UPDATE plant_status
        SET status = ?, title = ?, message = ?, started_at = NOW(),
            expected_restart_at = ?, updated_by = ?
        WHERE id = 1
        `,
        [status, title.trim(), message.trim(), expected_restart_at, req.user.id],
      );

      await connection.query(
        `
        INSERT INTO plant_status_history
          (status, title, message, started_at, expected_restart_at, started_by)
        VALUES (?, ?, ?, NOW(), ?, ?)
        `,
        [status, title.trim(), message.trim(), expected_restart_at, req.user.id],
      );
    }

    await connection.commit();

    const updated = await getPlantStatusRow();
    const data = serializeStatus(updated);
    const io = req.app.get("io");

    if (io) io.emit("plant_status_updated", data);

    return res.json({
      success: true,
      message:
        status === "running"
          ? "Plant marked as running"
          : status === "maintenance"
            ? "Plant maintenance started"
            : "Plant marked as stopped",
      data,
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: "Unable to change plant status",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const getPlantStatusHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT
        h.*,
        starter.name AS started_by_name,
        ender.name AS ended_by_name,
        TIMESTAMPDIFF(MINUTE, h.started_at, COALESCE(h.ended_at, NOW())) AS duration_minutes
      FROM plant_status_history h
      LEFT JOIN users starter ON starter.id = h.started_by
      LEFT JOIN users ender ON ender.id = h.ended_by
      ORDER BY h.started_at DESC
      LIMIT 200
      `,
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to get plant status history",
      error: error.message,
    });
  }
};

module.exports = {
  getPlantStatus,
  changePlantStatus,
  getPlantStatusHistory,
  getPlantStatusRow,
};
