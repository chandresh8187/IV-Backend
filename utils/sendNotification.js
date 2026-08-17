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

const normalizeRoles = (roles) => [
  ...new Set(
    (roles || [])
      .map((role) => String(role || "").toLowerCase().trim())
      .filter(Boolean),
  ),
];

const getRoleRecipients = async ({ roles, excludeRoles = [] }) => {
  // Supervisors enter the production data that creates these alerts and must
  // never be notification recipients, even if a caller accidentally includes
  // the role in its audience list.
  const includedRoles = normalizeRoles(roles).filter(
    (role) => role !== "supervisor",
  );
  const excludedRoles = normalizeRoles([...excludeRoles, "supervisor"]);

  if (!includedRoles.length) return [];

  const includedPlaceholders = includedRoles.map(() => "?").join(", ");
  const params = [...includedRoles];
  let excludedClause = "";

  if (excludedRoles.length) {
    excludedClause = `AND LOWER(TRIM(u.role)) NOT IN (${excludedRoles
      .map(() => "?")
      .join(", ")})`;
    params.push(...excludedRoles);
  }

  const [recipients] = await db.query(
    `SELECT u.id AS user_id,
            LOWER(TRIM(u.role)) AS role,
            NULLIF(TRIM(t.fcm_token), '') AS fcm_token
     FROM users u
     LEFT JOIN user_fcm_tokens t ON t.user_id = u.id
     WHERE LOWER(TRIM(u.role)) IN (${includedPlaceholders})
       ${excludedClause}
       AND u.status = 'active'`,
    params,
  );

  return recipients;
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
        notification: {
          channelId: "iv_production_alerts",
          priority: "high",
          sound: "default",
          defaultVibrateTimings: true,
        },
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

const sendNotificationToRoles = async ({
  roles,
  excludeRoles = [],
  title,
  body,
  data = {},
  io,
  socketEvent,
}) => {
  const recipients = await getRoleRecipients({ roles, excludeRoles });
  const recipientUserIds = [
    ...new Set(recipients.map((item) => Number(item.user_id)).filter(Boolean)),
  ];
  const tokens = [
    ...new Set(recipients.map((item) => item.fcm_token).filter(Boolean)),
  ];
  const registeredUserIds = new Set(
    recipients
      .filter((item) => item.fcm_token)
      .map((item) => Number(item.user_id)),
  );
  const roleStats = {};
  recipients.forEach((recipient) => {
    const role = recipient.role || "unknown";
    if (!roleStats[role]) {
      roleStats[role] = {
        eligibleUserIds: new Set(),
        registeredUserIds: new Set(),
      };
    }
    roleStats[role].eligibleUserIds.add(Number(recipient.user_id));
    if (recipient.fcm_token) {
      roleStats[role].registeredUserIds.add(Number(recipient.user_id));
    }
  });
  let socketConnectionCount = 0;

  if (io && socketEvent) {
    const socketPayload = { ...data, title, body };
    recipientUserIds.forEach((userId) => {
      socketConnectionCount +=
        io.sockets?.adapter?.rooms?.get(`user:${userId}`)?.size || 0;
      io.to(`user:${userId}`).emit(socketEvent, socketPayload);
    });
  }

  let pushResult = { successCount: 0, failureCount: 0 };
  let pushErrorCode = null;

  try {
    pushResult = await sendToTokens({
      tokens,
      title,
      body,
      data,
    });
  } catch (error) {
    pushResult.failureCount = tokens.length;
    pushErrorCode = String(error?.code || "FCM_DELIVERY_FAILED");
    console.error("FCM delivery failed:", error);
  }

  return {
    ...pushResult,
    eligibleUserCount: recipientUserIds.length,
    registeredUserCount: registeredUserIds.size,
    tokenCount: tokens.length,
    socketConnectionCount,
    pushErrorCode,
    roleStats: Object.fromEntries(
      Object.entries(roleStats).map(([role, stats]) => [
        role,
        {
          eligibleUserCount: stats.eligibleUserIds.size,
          registeredUserCount: stats.registeredUserIds.size,
        },
      ]),
    ),
  };
};

const sendNotificationToUser = async ({ userId, title, body, data = {} }) => {
  const [rows] = await db.query(
    `
    SELECT tokens.fcm_token
    FROM user_fcm_tokens tokens
    INNER JOIN users ON users.id = tokens.user_id
    WHERE tokens.user_id = ?
      AND users.status = 'active'
      AND LOWER(TRIM(users.role)) <> 'supervisor'
    `,
    [userId],
  );

  const tokens = rows.map((row) => row.fcm_token).filter(Boolean);
  const delivery = await sendToTokens({
    tokens,
    title,
    body,
    data,
  });

  return {
    ...delivery,
    tokenCount: new Set(tokens).size,
  };
};

module.exports = {
  sendNotificationToRoles,
  sendNotificationToUser,
};
