const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const serviceAccount = require("../firebase-ser.json");

const app = getApps()[0] || initializeApp({
  credential: cert(serviceAccount),
});

module.exports = {
  messaging: () => getMessaging(app),
};
