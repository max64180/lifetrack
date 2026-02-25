const crypto = require("node:crypto");
const { getDb, admin } = require("../_lib/firebaseAdmin");

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (err) {
      return {};
    }
  }
  return req.body;
}

function getBearer(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  try {
    const bearer = getBearer(req);
    if (!bearer) {
      res.status(401).json({ error: "missing_auth" });
      return;
    }
    const decoded = await admin.auth().verifyIdToken(bearer);
    const uid = decoded.uid;
    const payload = parseBody(req);
    const token = typeof payload.token === "string" ? payload.token.trim() : "";
    if (!token) {
      res.status(400).json({ error: "missing_token" });
      return;
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRef = getDb().collection("users").doc(uid).collection("pushTokens").doc(tokenHash);
    const snap = await tokenRef.get();
    const now = new Date().toISOString();
    await tokenRef.set({
      token,
      enabled: true,
      platform: payload.platform || "",
      language: payload.language || "it",
      createdAt: snap.exists ? (snap.data().createdAt || now) : now,
      updatedAt: now,
      lastSeenAt: now,
    }, { merge: true });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("push/register error:", error);
    res.status(500).json({ error: "internal_error" });
  }
};
