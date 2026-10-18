const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const firebase = require('../config/unit1FirebaseAdmin');

const validInstallation = value => /^[a-zA-Z0-9._:-]{16,100}$/.test(String(value || ''));
const validToken = value => typeof value === 'string' && value.length >= 20 && value.length <= 512 && !/\s/.test(value);

router.use(auth);

router.post('/token', async (req, res, next) => {
  const token = req.body?.token;
  const installationId = req.body?.installationId;
  const deviceType = req.body?.deviceType || 'android';
  if (!validToken(token) || !validInstallation(installationId) || !['android', 'ios'].includes(deviceType)) return res.status(400).json({ error: 'Valid device token, installation ID and device type are required.' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('DELETE FROM unit1_fcm_tokens WHERE installation_id=? OR fcm_token=?', [installationId, token]);
    await connection.execute('INSERT INTO unit1_fcm_tokens (user_id,installation_id,fcm_token,device_type) VALUES (?,?,?,?)', [req.user.id, installationId, token, deviceType]);
    await connection.commit();
    res.json({ data: { registered: true } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

router.delete('/token', async (req, res, next) => {
  const installationId = req.body?.installationId;
  if (!validInstallation(installationId)) return res.status(400).json({ error: 'Valid installation ID is required.' });
  try {
    await db.execute('DELETE FROM unit1_fcm_tokens WHERE user_id=? AND installation_id=?', [req.user.id, installationId]);
    res.json({ data: { removed: true } });
  } catch (error) { next(error); }
});

router.get('/status', async (req, res, next) => {
  try {
    const [[row]] = await db.execute('SELECT COUNT(*) AS deviceCount FROM unit1_fcm_tokens WHERE user_id=?', [req.user.id]);
    res.json({ data: { deviceCount: Number(row.deviceCount), senderConfigured: firebase.configured() } });
  } catch (error) { next(error); }
});

// Only expose device metadata for the authenticated Unit 1 account, never FCM tokens.
router.get('/devices', async (req, res, next) => {
  try {
    const [devices] = await db.execute("SELECT id, installation_id AS installationId, updated_at AS updatedAt FROM unit1_fcm_tokens WHERE user_id=? AND device_type='android' ORDER BY updated_at DESC LIMIT 100", [req.user.id]);
    res.json({ data: { devices, senderConfigured: firebase.configured() } });
  } catch (error) { next(error); }
});

router.post('/test', async (req, res, next) => {
  try {
    const { deviceType, deviceId } = req.body || {};
    if (deviceType !== undefined && !['android', 'ios'].includes(deviceType)) return res.status(400).json({ error: 'Invalid device type.' });
    if (deviceId !== undefined && (!Number.isSafeInteger(deviceId) || deviceId < 1 || deviceType !== 'android')) return res.status(400).json({ error: 'Select a valid Android device.' });
    const title = req.body?.title === undefined ? 'Unit 1 notifications ready' : req.body.title;
    const body = req.body?.body === undefined ? 'Firebase Cloud Messaging is connected to your Unit 1 account.' : req.body.body;
    if (typeof title !== 'string' || !title.trim() || title.length > 100 || typeof body !== 'string' || !body.trim() || body.length > 500) return res.status(400).json({ error: 'Enter a title (up to 100 characters) and message (up to 500 characters).' });
    const params = [req.user.id];
    let where = 'user_id=?';
    if (deviceType) { where += ' AND device_type=?'; params.push(deviceType); }
    if (deviceId !== undefined) { where += ' AND id=?'; params.push(deviceId); }
    const [rows] = await db.execute(`SELECT fcm_token AS token FROM unit1_fcm_tokens WHERE ${where} ORDER BY updated_at DESC LIMIT ${deviceType === 'android' ? 100 : 10}`, params);
    if (!rows.length) return res.status(409).json({ error: 'No matching registered devices. Sign into the Unit 1 Android app with this account and allow notifications first.' });
    if (!firebase.configured()) return res.status(503).json({ error: 'The Unit 1 notification sender is not configured on the backend.' });
    const response = await firebase.messaging().sendEachForMulticast({
      tokens: rows.map(row => row.token),
      notification: { title: title.trim(), body: body.trim() },
      data: { type: 'unit1_test' },
      android: { priority: 'high', notification: { channelId: 'unit1_production_alerts', priority: 'high', sound: 'default' } },
    });
    const invalid = response.responses.flatMap((item, index) => !item.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(item.error?.code) ? [rows[index].token] : []);
    if (invalid.length) await db.query(`DELETE FROM unit1_fcm_tokens WHERE fcm_token IN (${invalid.map(() => '?').join(',')})`, invalid);
    res.json({ data: { sent: response.successCount, failed: response.failureCount } });
  } catch (error) { next(error); }
});

module.exports = router;
