const db = require('../config/db');
const { getOnlineUserIds } = require('../services/chatPresenceService');
const { sendChatNotification } = require('../utils/sendNotification');

const messageSelect = `SELECT m.id, m.user_id, m.participant_id, m.message, m.reply_to_message_id,
  DATE_FORMAT(m.edited_at, '%Y-%m-%d %H:%i:%s') edited_at,
  DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') created_at,
  COALESCE(NULLIF(TRIM(m.sender_name), ''), u.name) user_name, u.role user_role,
  reply.message reply_message, reply_user.name reply_user_name,
  (SELECT COUNT(*) FROM chat_participant_reads receipt
   WHERE receipt.last_read_message_id >= m.id AND receipt.participant_id <> COALESCE(m.participant_id, 0)) seen_count
  FROM chat_messages m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN chat_messages reply ON reply.id = m.reply_to_message_id
  LEFT JOIN users reply_user ON reply_user.id = reply.user_id`;

const validateMessage = value => {
  const message = String(value || '').trim();
  if (!message || message.length > 1000) throw Object.assign(new Error('Message must contain 1 to 1000 characters.'), { status: 400 });
  return message;
};
const validateSenderName = value => {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) {
    throw Object.assign(new Error('Chat name must contain 2 to 60 characters.'), { status: 400 });
  }
  return name;
};
const fail = (res, error) => {
  if (!error.status) console.error('Chat request failed:', error);
  return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the chat request.' });
};
const validInstallation = value => /^[a-zA-Z0-9._:-]{16,100}$/.test(String(value || '').trim());
const registerParticipant = async (req, res) => {
  let connection;
  try {
    const installationId = String(req.body.installation_id || '').trim();
    const displayName = validateSenderName(req.body.display_name);
    const mobile = String(req.body.mobile_number || '').replace(/\D/g, '');
    if (!validInstallation(installationId)) throw Object.assign(new Error('Invalid device installation.'), { status: 400 });
    if (mobile.length < 10 || mobile.length > 15) throw Object.assign(new Error('Enter a valid mobile number.'), { status: 400 });
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [existingDevices] = await connection.query(`SELECT participant.mobile_number
      FROM chat_participant_devices device JOIN chat_participants participant ON participant.id=device.participant_id
      WHERE device.installation_id=? FOR UPDATE`, [installationId]);
    if (existingDevices.length && existingDevices[0].mobile_number !== mobile) {
      throw Object.assign(new Error('This device is already registered to another chat participant.'), { status: 409 });
    }
    const [mobileRows] = await connection.query('SELECT id FROM chat_participants WHERE mobile_number=? ORDER BY id LIMIT 1 FOR UPDATE', [mobile]);
    let participantId = mobileRows[0]?.id;
    if (participantId) {
      await connection.query('UPDATE chat_participants SET display_name=?, last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?', [displayName, participantId]);
    } else {
      const [created] = await connection.query('INSERT INTO chat_participants (user_id, installation_id, display_name, mobile_number) VALUES (?, ?, ?, ?)', [req.user.id, installationId, displayName, mobile]);
      participantId = created.insertId;
    }
    await connection.query(`INSERT INTO chat_participant_devices (installation_id, participant_id) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE participant_id=VALUES(participant_id), updated_at=CURRENT_TIMESTAMP`, [installationId, participantId]);
    const [[participant]] = await connection.query('SELECT id, display_name, mobile_number FROM chat_participants WHERE id=?', [participantId]);
    await connection.commit();
    return res.json({ success: true, data: participant });
  } catch (error) { if (connection) await connection.rollback().catch(() => {}); return fail(res, error); }
  finally { connection?.release(); }
};

const getChat = async (req, res) => {
  try {
    const installationId = String(req.query.installation_id || '').trim();
    const [[viewer]] = validInstallation(installationId)
      ? await db.query('SELECT participant.id FROM chat_participant_devices device JOIN chat_participants participant ON participant.id=device.participant_id WHERE device.installation_id=? LIMIT 1', [installationId])
      : [[]];
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const [messages] = await db.query(`${messageSelect} ORDER BY m.id DESC LIMIT ?`, [limit]);
    const [users] = await db.query(`SELECT cp.id, cp.user_id, cp.display_name name, cp.mobile_number, u.role
      FROM chat_participants cp JOIN users u ON u.id=cp.user_id
      WHERE u.status='active' AND cp.id=(SELECT MIN(same_mobile.id) FROM chat_participants same_mobile WHERE same_mobile.mobile_number=cp.mobile_number)
      ORDER BY cp.display_name`);
    const [[unread]] = await db.query(`SELECT COUNT(*) unread_count FROM chat_messages m
      WHERE m.id > COALESCE((SELECT last_read_message_id FROM chat_read_receipts WHERE user_id = ?), 0)
        AND m.user_id <> ?`, [req.user.id, req.user.id]);
    const online = new Set(getOnlineUserIds());
    return res.json({ success: true, data: {
      messages: messages.reverse(),
      users: users.map(user => ({ ...user, online: online.has(Number(user.user_id)) })),
      online_user_ids: [...online],
      unread_count: Number(unread?.unread_count || 0),
      participant_id: viewer?.id || null,
    } });
  } catch (error) { return fail(res, error); }
};

const markChatRead = async (req, res) => {
  try {
    const installationId = String(req.body?.installation_id || '').trim();
    const [[participant]] = await db.query('SELECT participant.id FROM chat_participant_devices device JOIN chat_participants participant ON participant.id=device.participant_id WHERE device.installation_id=? LIMIT 1', [installationId]);
    if (!participant) throw Object.assign(new Error('Register your chat profile first.'), { status: 409 });
    const [[latest]] = await db.query('SELECT COALESCE(MAX(id), 0) last_id FROM chat_messages');
    const newestId = Number(latest?.last_id || 0);
    const requestedId = Number(req.body?.last_message_id);
    const lastId = Number.isSafeInteger(requestedId) && requestedId >= 0
      ? Math.min(requestedId, newestId)
      : newestId;
    await db.query(`INSERT INTO chat_read_receipts (user_id, last_read_message_id) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id)), updated_at = CURRENT_TIMESTAMP`, [req.user.id, lastId]);
    await db.query(`INSERT INTO chat_participant_reads (participant_id, last_read_message_id) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id)), updated_at = CURRENT_TIMESTAMP`, [participant.id, lastId]);
    req.app.get('io')?.to('chat').emit('chat_messages_seen', { participant_id: participant.id, last_read_message_id: lastId });
    return res.json({ success: true, data: { unread_count: 0, last_read_message_id: lastId } });
  } catch (error) { return fail(res, error); }
};

const createMessage = async (req, res) => {
  try {
    const message = validateMessage(req.body.message);
    const installationId = String(req.body.installation_id || '').trim();
    if (!validInstallation(installationId)) throw Object.assign(new Error('Register this device for chat first.'), { status: 400 });
    const [[participant]] = await db.query('SELECT participant.id, participant.display_name FROM chat_participant_devices device JOIN chat_participants participant ON participant.id=device.participant_id WHERE device.installation_id=? LIMIT 1', [installationId]);
    if (!participant) throw Object.assign(new Error('Register your chat profile first.'), { status: 409 });
    const senderName = participant.display_name;
    const replyToMessageId = req.body.reply_to_message_id == null
      ? null
      : Number(req.body.reply_to_message_id);
    if (replyToMessageId != null) {
      if (!Number.isSafeInteger(replyToMessageId) || replyToMessageId < 1) {
        throw Object.assign(new Error('Invalid reply message.'), { status: 400 });
      }
      const [replyRows] = await db.query('SELECT id FROM chat_messages WHERE id = ? LIMIT 1', [replyToMessageId]);
      if (!replyRows.length) throw Object.assign(new Error('The message being replied to is no longer available.'), { status: 404 });
    }
    const [result] = await db.query(
      'INSERT INTO chat_messages (user_id, participant_id, sender_name, message, reply_to_message_id) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, participant.id, senderName, message, replyToMessageId],
    );
    const [[saved]] = await db.query(`${messageSelect} WHERE m.id = ?`, [result.insertId]);
    req.app.get('io')?.to('chat').emit('chat_message_created', saved);
    sendChatNotification({
      senderInstallationId: installationId,
      senderName: saved.user_name,
      message: saved.message,
      messageId: saved.id,
    }).catch(error => console.error('Chat notification delivery failed:', error));
    return res.status(201).json({ success: true, data: saved });
  } catch (error) { return fail(res, error); }
};

const updateMessage = async (req, res) => {
  try {
    const id = Number(req.params.id); const message = validateMessage(req.body.message);
    const [rows] = await db.query('SELECT user_id FROM chat_messages WHERE id = ?', [id]);
    if (!rows.length) throw Object.assign(new Error('Message not found.'), { status: 404 });
    if (Number(rows[0].user_id) !== Number(req.user.id) && req.user.role !== 'superadmin') throw Object.assign(new Error('You can only edit your own messages.'), { status: 403 });
    await db.query('UPDATE chat_messages SET message = ?, edited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [message, id]);
    const [[saved]] = await db.query(`${messageSelect} WHERE m.id = ?`, [id]);
    req.app.get('io')?.to('chat').emit('chat_message_updated', saved);
    return res.json({ success: true, data: saved });
  } catch (error) { return fail(res, error); }
};

const deleteMessage = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await db.query('SELECT user_id FROM chat_messages WHERE id = ?', [id]);
    if (!rows.length) throw Object.assign(new Error('Message not found.'), { status: 404 });
    if (Number(rows[0].user_id) !== Number(req.user.id) && req.user.role !== 'superadmin') throw Object.assign(new Error('You can only delete your own messages.'), { status: 403 });
    await db.query('DELETE FROM chat_messages WHERE id = ?', [id]);
    req.app.get('io')?.to('chat').emit('chat_message_deleted', { id });
    return res.json({ success: true, message: 'Message deleted.' });
  } catch (error) { return fail(res, error); }
};

module.exports = { getChat, registerParticipant, markChatRead, createMessage, updateMessage, deleteMessage };
