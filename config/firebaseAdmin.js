const fs = require('fs');
const path = require('path');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

const PROJECT_ID = 'iv-app-b1240';

function messaging() {
  const file = String(process.env.UNIT2_FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (!file) throw Object.assign(new Error('Set UNIT2_FIREBASE_SERVICE_ACCOUNT_PATH to the Unit 2 Firebase service account JSON file.'), { status: 503 });
  const account = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (account.project_id !== PROJECT_ID) throw Object.assign(new Error('The Firebase service account does not belong to the Unit 2 Firebase project.'), { status: 503 });
  const app = getApps().find(item => item.name === 'unit2') || initializeApp({ credential: cert(account), projectId: PROJECT_ID }, 'unit2');
  return getMessaging(app);
}

module.exports = { messaging, PROJECT_ID };
