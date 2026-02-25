const { getApp, getDb } = require("../_lib/firebaseAdmin");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const hasProjectId = Boolean(process.env.FIREBASE_PROJECT_ID);
  const hasClientEmail = Boolean(process.env.FIREBASE_CLIENT_EMAIL);
  const hasPrivateKey = Boolean(process.env.FIREBASE_PRIVATE_KEY);
  const keyPreview = (process.env.FIREBASE_PRIVATE_KEY || "").slice(0, 40);
  try {
    getApp();
    // Fire a tiny read to ensure Admin + Firestore are healthy.
    await getDb().collection("users").limit(1).get();
    res.status(200).json({
      ok: true,
      hasProjectId,
      hasClientEmail,
      hasPrivateKey,
      keyPreview,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      hasProjectId,
      hasClientEmail,
      hasPrivateKey,
      keyPreview,
      code: String(error?.code || ""),
      message: String(error?.message || "").slice(0, 180),
    });
  }
};
