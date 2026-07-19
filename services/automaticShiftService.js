const { DateTime } = require("luxon");
const db = require("../config/db");

const TIME_ZONE = "Asia/Kolkata";
const DAY_SHIFT_START_HOUR = 8;
const NIGHT_SHIFT_START_HOUR = 20;

const toMySqlDateTime = (dateTime) => dateTime.toFormat("yyyy-LL-dd HH:mm:ss");

/**
 * Calculates the operational shift from India time.
 *
 * Day shift:   08:00:00 to 19:59:59
 * Night shift: 20:00:00 to 07:59:59 on the following calendar day
 *
 * A night shift after midnight keeps the previous date as shift_date.
 */
const getCurrentShiftInfo = (inputDateTime = null) => {
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

  if (!now.isValid) {
    throw new Error(`Invalid date supplied to automatic shift service: ${now.invalidReason}`);
  }

  const isDayShift =
    now.hour >= DAY_SHIFT_START_HOUR && now.hour < NIGHT_SHIFT_START_HOUR;

  let shiftName;
  let shiftDateTime;
  let shiftStart;
  let shiftEnd;

  if (isDayShift) {
    shiftName = "day";
    shiftDateTime = now.startOf("day");
    shiftStart = shiftDateTime.set({ hour: DAY_SHIFT_START_HOUR });
    shiftEnd = shiftDateTime.set({ hour: NIGHT_SHIFT_START_HOUR });
  } else {
    shiftName = "night";

    // 00:00–07:59 belongs to the previous day's night shift.
    shiftDateTime =
      now.hour < DAY_SHIFT_START_HOUR
        ? now.minus({ days: 1 }).startOf("day")
        : now.startOf("day");

    shiftStart = shiftDateTime.set({ hour: NIGHT_SHIFT_START_HOUR });
    shiftEnd = shiftDateTime.plus({ days: 1 }).set({ hour: DAY_SHIFT_START_HOUR });
  }

  return {
    shift_name: shiftName,
    shift_date: shiftDateTime.toISODate(),
    shift_start: toMySqlDateTime(shiftStart),
    shift_end: toMySqlDateTime(shiftEnd),
    current_time: toMySqlDateTime(now),
    timezone: TIME_ZONE,
    year: shiftDateTime.year,
    month: shiftDateTime.month,
  };
};

/**
 * Returns the current database shift and guarantees that exactly the correct
 * day/night shift is marked active. This is intentionally called by status,
 * dashboard, and production APIs so the system does not depend on a cron job.
 */
const ensureAutomaticShift = async () => {
  const connection = await db.getConnection();

  try {
    const shiftInfo = getCurrentShiftInfo();

    await connection.beginTransaction();

    const [activeRows] = await connection.query(
      `
      SELECT *
      FROM shifts
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
    );

    const activeShift = activeRows[0] || null;
    const activeShiftDate = activeShift?.shift_date
      ? DateTime.fromJSDate(new Date(activeShift.shift_date), {
          zone: TIME_ZONE,
        }).toISODate()
      : null;

    if (
      activeShift &&
      activeShift.shift_name === shiftInfo.shift_name &&
      activeShiftDate === shiftInfo.shift_date
    ) {
      await connection.query(
        `UPDATE shift_settings SET current_shift = ? WHERE id = 1`,
        [shiftInfo.shift_name],
      );

      await connection.commit();

      return {
        ...activeShift,
        shift_date: shiftInfo.shift_date,
        automatic: true,
        timezone: TIME_ZONE,
        scheduled_end_time: shiftInfo.shift_end,
      };
    }

    // Close every stale active row at the exact boundary where the new shift began.
    await connection.query(
      `
      UPDATE shifts
      SET end_time = ?, status = 'closed', ended_by = NULL
      WHERE status = 'active'
      `,
      [shiftInfo.shift_start],
    );

    const [existingRows] = await connection.query(
      `
      SELECT *
      FROM shifts
      WHERE shift_name = ? AND shift_date = ?
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [shiftInfo.shift_name, shiftInfo.shift_date],
    );

    let currentShift;

    if (existingRows.length > 0) {
      currentShift = existingRows[0];

      await connection.query(
        `
        UPDATE shifts
        SET
          start_time = ?,
          end_time = NULL,
          started_by = NULL,
          ended_by = NULL,
          status = 'active'
        WHERE id = ?
        `,
        [shiftInfo.shift_start, currentShift.id],
      );
    } else {
      const [result] = await connection.query(
        `
        INSERT INTO shifts
          (shift_name, shift_date, start_time, end_time, started_by, ended_by, status)
        VALUES (?, ?, ?, NULL, NULL, NULL, 'active')
        `,
        [shiftInfo.shift_name, shiftInfo.shift_date, shiftInfo.shift_start],
      );

      currentShift = {
        id: result.insertId,
        shift_name: shiftInfo.shift_name,
        shift_date: shiftInfo.shift_date,
      };
    }

    await connection.query(
      `UPDATE shift_settings SET current_shift = ? WHERE id = 1`,
      [shiftInfo.shift_name],
    );

    await connection.commit();

    return {
      ...currentShift,
      shift_name: shiftInfo.shift_name,
      shift_date: shiftInfo.shift_date,
      start_time: shiftInfo.shift_start,
      end_time: null,
      started_by: null,
      ended_by: null,
      status: "active",
      automatic: true,
      timezone: TIME_ZONE,
      scheduled_end_time: shiftInfo.shift_end,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  TIME_ZONE,
  DAY_SHIFT_START_HOUR,
  NIGHT_SHIFT_START_HOUR,
  getCurrentShiftInfo,
  ensureAutomaticShift,
};
