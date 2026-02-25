const admin = require("firebase-admin");

let initialized = false;

function getPrivateKey() {
  const raw = process.env.FIREBASE_PRIVATE_KEY || "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function getApp() {
  if (!initialized) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: getPrivateKey(),
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
