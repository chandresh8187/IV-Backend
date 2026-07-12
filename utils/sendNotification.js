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
    AND t.fcm_token IS NOT NULL
    AND t.fcm_token != ''
    `,
    [roles],
  );

  const fcmTokens = tokens.map((item) => item.fcm_token);

  if (fcmTokens.length === 0) {
    console.log("No FCM tokens found for roles:", roles);
    return;
  }

  const response = await admin.messaging().sendEachForMulticast({
    tokens: fcmTokens,
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
        channelId: "default",
        sound: "default",
      },
    },
  });

  console.log("FCM response:", response.successCount, response.failureCount);
};

module.exports = {
  sendNotificationToRoles,
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
