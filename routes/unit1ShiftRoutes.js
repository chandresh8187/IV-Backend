const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { getSchedule, validateSchedule, currentShift } = require('../services/unit1ShiftService');
const { publishUnit1Change } = require('../services/unit1Realtime');

router.use(auth);

router.get('/', access([], 'unit1.shifts.view'), async (_req, res, next) => {
  try {
    const schedule = await getSchedule();
    res.json({ data: { schedule, current: currentShift(schedule) } });
  } catch (error) { next(error); }
});

router.put('/', access([], 'unit1.shifts.manage'), async (req, res, next) => {
  const result = validateSchedule(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const schedule = result.value;
  try {
    await db.execute('UPDATE unit1_shift_settings SET day_start = ?, day_end = ?, night_start = ?, night_end = ? WHERE id = 1', [schedule.dayStart, schedule.dayEnd, schedule.nightStart, schedule.nightEnd]);
    publishUnit1Change(req, 'shifts', { action: 'schedule_updated' });
    res.json({ data: { schedule, current: currentShift(schedule) } });
  } catch (error) { next(error); }
});

module.exports = router;
