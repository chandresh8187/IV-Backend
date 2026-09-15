const { DateTime } = require("luxon");
const db = require("../config/db");
const { getSetting } = require("./appSettingsService");

const TIME_ZONE = "Asia/Kolkata";

const toMinutes = (value) => {
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
};

const toMySqlDateTime = (value) => value.toFormat("yyyy-LL-dd HH:mm:ss");

const toTimeText = (minutes) => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
  const remainingMinutes = String(normalized % 60).padStart(2, "0");
  return `${hours}:${remainingMinutes}`;
};

const deriveNightShiftStart = (dayStart = "08:00") =>
  toTimeText(toMinutes(dayStart) + 12 * 60);

const getShiftSchedule = async (executor = db) => {
  const stored = await getSetting("shift_schedule", executor);
  const dayStart = /^([01]\d|2[0-3]):([0-5]\d)$/.test(stored.day_start)
    ? stored.day_start
    : "08:00";

  return {
    automatic: true,
    day_start: dayStart,
    night_start: deriveNightShiftStart(dayStart),
  };
};

const getCurrentShiftInfo = (inputDateTime = null, schedule = {}) => {
  const requestedDayStart = schedule.day_start || "08:00";
  const dayStartText = /^([01]\d|2[0-3]):([0-5]\d)$/.test(requestedDayStart)
    ? requestedDayStart
    : "08:00";
  const nightStartText = deriveNightShiftStart(dayStartText);
  const [dayHour, dayMinute] = dayStartText.split(":").map(Number);

  let now;
  if (inputDateTime && DateTime.isDateTime(inputDateTime)) {
    now = inputDateTime.setZone(TIME_ZONE);
  } else if (inputDateTime instanceof Date) {
    now = DateTime.fromJSDate(inputDateTime, { zone: TIME_ZONE });
  } else if (typeof inputDateTime === "string") {
    now = DateTime.fromISO(inputDateTime, { zone: TIME_ZONE });
  } else {
    now = DateTime.now().setZone(TIME_ZONE);
  }

  if (!now.isValid) throw new Error("Invalid date supplied to shift service");

  const todayDayStart = now
    .startOf("day")
    .set({ hour: dayHour, minute: dayMinute });
  const operationalDayStart =
    now.toMillis() < todayDayStart.toMillis()
      ? todayDayStart.minus({ days: 1 })
      : todayDayStart;
  const elapsedMinutes = now.diff(operationalDayStart, "minutes").minutes;
  const isDay = elapsedMinutes < 12 * 60;
  const shiftStart = isDay
    ? operationalDayStart
    : operationalDayStart.plus({ hours: 12 });
  const shiftEnd = shiftStart.plus({ hours: 12 });
  const shiftDate = operationalDayStart.startOf("day");

  return {
    shift_name: isDay ? "day" : "night",
    shift_date: shiftDate.toISODate(),
    shift_start: toMySqlDateTime(shiftStart),
    shift_end: toMySqlDateTime(shiftEnd),
    current_time: toMySqlDateTime(now),
    timezone: TIME_ZONE,
    automatic: true,
    day_start: dayStartText,
    night_start: nightStartText,
    year: shiftDate.year,
    month: shiftDate.month,
  };
};

const formatDbDate = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return DateTime.fromJSDate(new Date(value), { zone: TIME_ZONE }).toISODate();
};

// Called by status/dashboard/production APIs, so no cron job is required.
const ensureAutomaticShift = async () => {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    const schedule = await getShiftSchedule(connection);

    const info = getCurrentShiftInfo(null, schedule);
    await connection.beginTransaction();
    transactionStarted = true;

    const [activeRows] = await connection.query(
      "SELECT * FROM shifts WHERE status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE",
    );
    const active = activeRows[0] || null;

    if (
      active &&
      active.shift_name === info.shift_name &&
      formatDbDate(active.shift_date) === info.shift_date
    ) {
      await connection.query(
        "UPDATE shift_settings SET current_shift = ? WHERE id = 1",
        [info.shift_name],
      );
      await connection.commit();
      transactionStarted = false;
      return {
        ...active,
        shift_date: info.shift_date,
        automatic: true,
        timezone: TIME_ZONE,
        scheduled_end_time: info.shift_end,
      };
    }

    await connection.query(
      `UPDATE shifts
       SET end_time = ?, status = 'closed', ended_by = NULL
       WHERE status = 'active'`,
      [info.shift_start],
    );

    const [existing] = await connection.query(
      `SELECT * FROM shifts
       WHERE shift_name = ? AND shift_date = ?
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [info.shift_name, info.shift_date],
    );

    let id;
    if (existing.length) {
      id = existing[0].id;
      await connection.query(
        `UPDATE shifts SET start_time = ?, end_time = NULL,
         started_by = NULL, ended_by = NULL, status = 'active'
         WHERE id = ?`,
        [info.shift_start, id],
      );
    } else {
      const [insert] = await connection.query(
        `INSERT INTO shifts
         (shift_name, shift_date, start_time, end_time, started_by, ended_by, status)
         VALUES (?, ?, ?, NULL, NULL, NULL, 'active')`,
        [info.shift_name, info.shift_date, info.shift_start],
      );
      id = insert.insertId;
    }

    await connection.query(
      "UPDATE shift_settings SET current_shift = ? WHERE id = 1",
      [info.shift_name],
    );
    await connection.commit();
    transactionStarted = false;

    return {
      id,
      shift_name: info.shift_name,
      shift_date: info.shift_date,
      start_time: info.shift_start,
      end_time: null,
      status: "active",
      automatic: true,
      timezone: TIME_ZONE,
      scheduled_end_time: info.shift_end,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Nothing to roll back when the failure happened before the transaction.
      }
    }
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  TIME_ZONE,
  deriveNightShiftStart,
  getShiftSchedule,
  getCurrentShiftInfo,
  ensureAutomaticShift,
};
