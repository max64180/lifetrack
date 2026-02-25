const admin = require("firebase-admin");

let initialized = false;

function getPrivateKey() {
  let raw = (process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (!raw) return "";
  // Allow values pasted with wrapping quotes from JSON/env UIs.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  return raw.replace(/\\n/g, "\n").replace(/\r/g, "");
}

function getApp() {
  if (!initialized) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = getPrivateKey();
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("firebase_admin_env_missing");
    }
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    initialized = true;
  }
  return admin.app();
}

function getDb() {
  getApp();
  return admin.firestore();
}

function getMessaging() {
  getApp();
  return admin.messaging();
}

module.exports = {
  admin,
  getApp,
  getDb,
  getMessaging,
};
