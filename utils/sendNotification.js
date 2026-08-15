const db = require("../config/db");

const getMessaging = () => require("../config/firebaseAdmin").messaging();
const MAX_MULTICAST_TOKENS = 500;
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

const deleteInvalidTokens = async (tokens) => {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  if (!uniqueTokens.length) return;

  const placeholders = uniqueTokens.map(() => "?").join(", ");
  await db.query(
    `DELETE FROM user_fcm_tokens WHERE fcm_token IN (${placeholders})`,
    uniqueTokens,
  );
};

const sendToTokens = async ({ tokens, title, body, data = {} }) => {
  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];
  if (uniqueTokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
    };
  }

  const stringData = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)]),
  );
  const invalidTokens = [];
  let successCount = 0;
  let failureCount = 0;

  for (let index = 0; index < uniqueTokens.length; index += MAX_MULTICAST_TOKENS) {
    const batch = uniqueTokens.slice(index, index + MAX_MULTICAST_TOKENS);
    const response = await getMessaging().sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data: stringData,
      android: {
        priority: "high",
        notification: { sound: "default" },
      },
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((result, responseIndex) => {
      if (
        !result.success &&
        INVALID_TOKEN_CODES.has(result.error?.code)
      ) {
        invalidTokens.push(batch[responseIndex]);
      }
    });
  }

  await deleteInvalidTokens(invalidTokens);
  return { successCount, failureCount };
};

const sendNotificationToRoles = async ({ roles, title, body, data = {} }) => {
  const [tokens] = await db.query(
    `
    SELECT 
      u.id AS user_id,
      u.name,
      u.role,
      t.fcm_token
    FROM users u
    INNER JOIN user_fcm_tokens t ON t.user_id = u.id
    WHERE u.role IN (?)
    AND u.status = 'active'
    AND t.fcm_token IS NOT NULL
    AND t.fcm_token != ''
    `,
    [roles],
  );

  return sendToTokens({
    tokens: tokens.map((item) => item.fcm_token),
    title,
    body,
    data,
  });
};

const sendNotificationToUser = async ({ userId, title, body, data = {} }) => {
  const [rows] = await db.query(
    `
    SELECT fcm_token
    FROM user_fcm_tokens
    WHERE user_id = ?
    `,
    [userId],
  );

  const tokens = rows.map((row) => row.fcm_token).filter(Boolean);

  return sendToTokens({
    tokens,
    title,
    body,
    data,
  });
};

module.exports = {
  sendNotificationToRoles,
  sendNotificationToUser,
};
