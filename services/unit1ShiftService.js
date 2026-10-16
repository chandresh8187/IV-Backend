const { DateTime } = require('luxon');
const db = require('../config/unit1Db');

const ZONE = 'Asia/Kolkata';
const DEFAULT_SCHEDULE = Object.freeze({ dayStart: '08:00', dayEnd: '20:00', nightStart: '20:00', nightEnd: '08:00' });
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

function validateSchedule(input) {
  const schedule = Object.fromEntries(Object.keys(DEFAULT_SCHEDULE).map(key => [key, String(input?.[key] || '').trim()]));
  if (Object.values(schedule).some(value => !timePattern.test(value))) return { error: 'Enter all shift times in HH:mm format.' };
  if (schedule.dayEnd !== schedule.nightStart || schedule.nightEnd !== schedule.dayStart) return { error: 'Day end must equal Night start, and Night end must equal Day start.' };
  const dayMinutes = (minutes(schedule.dayEnd) - minutes(schedule.dayStart) + 1440) % 1440;
  if (!dayMinutes) return { error: 'Day and Night shifts must each have a duration.' };
  return { value: schedule };
}

async function getSchedule(executor = db) {
  const [[row]] = await executor.execute('SELECT day_start AS dayStart, day_end AS dayEnd, night_start AS nightStart, night_end AS nightEnd FROM unit1_shift_settings WHERE id = 1');
  return row ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value).slice(0, 5)])) : { ...DEFAULT_SCHEDULE };
}

function currentShift(schedule, instant = DateTime.now()) {
  const now = instant.setZone(ZONE);
  let dayStart = now.startOf('day').plus({ minutes: minutes(schedule.dayStart) });
  if (now < dayStart) dayStart = dayStart.minus({ days: 1 });
  const dayEnd = dayStart.plus({ minutes: (minutes(schedule.dayEnd) - minutes(schedule.dayStart) + 1440) % 1440 });
  const nightEnd = dayStart.plus({ days: 1 });
  const isDay = now < dayEnd;
  return {
    name: isDay ? 'day' : 'night',
    shiftDate: dayStart.toISODate(),
    startsAt: (isDay ? dayStart : dayEnd).toISO(),
    endsAt: (isDay ? dayEnd : nightEnd).toISO(),
    serverTime: now.toISO(),
    timezone: ZONE,
  };
}

module.exports = { DEFAULT_SCHEDULE, validateSchedule, getSchedule, currentShift };
