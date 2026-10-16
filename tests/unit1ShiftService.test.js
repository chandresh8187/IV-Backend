const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { DEFAULT_SCHEDULE, validateSchedule, currentShift } = require('../services/unit1ShiftService');

test('Unit 1 shift schedule requires contiguous Day and Night times', () => {
  assert.deepEqual(validateSchedule(DEFAULT_SCHEDULE).value, DEFAULT_SCHEDULE);
  assert.match(validateSchedule({ ...DEFAULT_SCHEDULE, nightStart: '21:00' }).error, /Day end/);
  assert.match(validateSchedule({ ...DEFAULT_SCHEDULE, dayStart: '08:00', dayEnd: '08:00', nightStart: '08:00', nightEnd: '08:00' }).error, /duration/);
});

test('Unit 1 shifts change automatically at boundaries and preserve the night operational date', () => {
  const at = time => currentShift(DEFAULT_SCHEDULE, DateTime.fromISO(time));
  assert.equal(at('2026-10-12T07:59:00+05:30').name, 'night');
  assert.equal(at('2026-10-12T07:59:00+05:30').shiftDate, '2026-10-11');
  assert.equal(at('2026-10-12T08:00:00+05:30').name, 'day');
  assert.equal(at('2026-10-12T20:00:00+05:30').name, 'night');
  assert.equal(at('2026-10-13T00:30:00+05:30').shiftDate, '2026-10-12');
});
