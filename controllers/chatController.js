const db = require('../config/db');
const { getOnlineUserIds, getActiveChatUserIds } = require('../services/chatPresenceService');
const { sendChatNotification } = require('../utils/sendNotification');

const messageSelect = `SELECT m.id, m.user_id, m.message, m.reply_to_message_id,
  DATE_FORMAT(m.edited_at, '%Y-%m-%d %H:%i:%s') edited_at,
  DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') created_at,
  u.name user_name, u.role user_role,
  reply.message reply_message, reply_user.name reply_user_name
  FROM chat_messages m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN chat_messages reply ON reply.id = m.reply_to_message_id
  LEFT JOIN users reply_user ON reply_user.id = reply.user_id`;

const validateMessage = value => {
  const message = String(value || '').trim();
  if (!message || message.length > 1000) throw Object.assign(new Error('Message must contain 1 to 1000 characters.'), { status: 400 });
  return message;
};
const fail = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the chat request.' });

const getChat = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const [messages] = await db.query(`${messageSelect} ORDER BY m.id DESC LIMIT ?`, [limit]);
    const [users] = await db.query(`SELECT id, name, role FROM users WHERE status = 'active' ORDER BY name`);
    const [[unread]] = await db.query(`SELECT COUNT(*) unread_count FROM chat_messages m
      WHERE m.id > COALESCE((SELECT last_read_message_id FROM chat_read_receipts WHERE user_id = ?), 0)
        AND m.user_id <> ?`, [req.user.id, req.user.id]);
    const online = new Set(getOnlineUserIds());
    return res.json({ success: true, data: {
      messages: messages.reverse(),
      users: users.map(user => ({ ...user, online: online.has(Number(user.id)) })),
      online_user_ids: [...online],
      unread_count: Number(unread?.unread_count || 0),
    } });
  } catch (error) { return fail(res, error); }
};

const markChatRead = async (req, res) => {
  try {
    const [[latest]] = await db.query('SELECT COALESCE(MAX(id), 0) last_id FROM chat_messages');
    const newestId = Number(latest?.last_id || 0);
    const requestedId = Number(req.body?.last_message_id);
    const lastId = Number.isSafeInteger(requestedId) && requestedId >= 0
      ? Math.min(requestedId, newestId)
      : newestId;
    await db.query(`INSERT INTO chat_read_receipts (user_id, last_read_message_id) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id)), updated_at = CURRENT_TIMESTAMP`, [req.user.id, lastId]);
    return res.json({ success: true, data: { unread_count: 0, last_read_message_id: lastId } });
  } catch (error) { return fail(res, error); }
};

const createMessage = async (req, res) => {
  try {
    const message = validateMessage(req.body.message);
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
      'INSERT INTO chat_messages (user_id, message, reply_to_message_id) VALUES (?, ?, ?)',
      [req.user.id, message, replyToMessageId],
    );
    const [[saved]] = await db.query(`${messageSelect} WHERE m.id = ?`, [result.insertId]);
    req.app.get('io')?.to('chat').emit('chat_message_created', saved);
    sendChatNotification({
      senderUserId: req.user.id,
      excludeUserIds: getActiveChatUserIds(),
      senderName: saved.user_name,
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

module.exports = { getChat, markChatRead, createMessage, updateMessage, deleteMessage };
