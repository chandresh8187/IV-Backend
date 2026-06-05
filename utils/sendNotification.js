const db = require("../config/db");
const admin = require("../config/firebaseAdmin");

const sendToTokens = async ({ tokens, title, body, data = {} }) => {
  if (!tokens || tokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
    };
  }

  const message = {
    tokens,
    notification: {
      title,
      body,
    },
    data: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, String(value)]),
    ),
    android: {
      priority: "high",
      notification: {
        channelId: "production_notifications",
        sound: "default",
      },
    },
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  return response;
};

const sendNotificationToRoles = async ({ roles, title, body, data = {} }) => {
  const [rows] = await db.query(
    `
    SELECT uft.fcm_token
    FROM user_fcm_tokens uft
    INNER JOIN users u ON u.id = uft.user_id
    WHERE u.role IN (?)
    `,
    [roles],
  );

  const tokens = rows.map((row) => row.fcm_token).filter(Boolean);

  return sendToTokens({
    tokens,
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
