const fs = require('fs');
const path = require('path');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

const PROJECT_ID = 'ivs1production-68d13';
const credentialsPath = () => String(process.env.UNIT1_FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();

function configured() {
  const file = credentialsPath();
  if (!file || !fs.existsSync(path.resolve(file))) return false;
  try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')).project_id === PROJECT_ID; }
  catch (_) { return false; }
}

function messaging() {
  const file = credentialsPath();
  if (!file) throw Object.assign(new Error('Set UNIT1_FIREBASE_SERVICE_ACCOUNT_PATH to the Unit 1 Firebase service account JSON file.'), { status: 503 });
  const account = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (account.project_id !== PROJECT_ID) throw Object.assign(new Error('The Firebase service account does not belong to the Unit 1 Firebase project.'), { status: 503 });
  const app = getApps().find(item => item.name === 'unit1') || initializeApp({ credential: cert(account), projectId: PROJECT_ID }, 'unit1');
  return getMessaging(app);
}

module.exports = { configured, messaging, PROJECT_ID };
