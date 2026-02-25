const crypto = require("node:crypto");
const { getDb, getApp, admin } = require("../_lib/firebaseAdmin");

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

function inferPlatformKind(rawPlatform) {
  const ua = String(rawPlatform || "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
  if (ua.includes("android")) return "android";
  if (ua.includes("windows") || ua.includes("macintosh") || ua.includes("linux") || ua.includes("cros")) return "desktop";
  return "unknown";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  try {
    getApp();
    const bearer = getBearer(req);
    if (!bearer) {
      res.status(401).json({ error: "missing_auth" });
      return;
    }
    const decoded = await admin.auth().verifyIdToken(bearer);
    const uid = decoded.uid;
    const payload = parseBody(req);
    const token = typeof payload.token === "string" ? payload.token.trim() : "";
    const deviceId = typeof payload.deviceId === "string" ? payload.deviceId.trim() : "";
    if (!token) {
      res.status(400).json({ error: "missing_token" });
      return;
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const db = getDb();
    const tokensCol = db.collection("users").doc(uid).collection("pushTokens");
    const tokenRef = tokensCol.doc(tokenHash);
    const snap = await tokenRef.get();
    const now = new Date().toISOString();
    await tokenRef.set({
      token,
      enabled: true,
      deviceId: deviceId || "",
      platform: payload.platform || "",
      platformKind: inferPlatformKind(payload.platform),
      language: payload.language || "it",
      createdAt: snap.exists ? (snap.data().createdAt || now) : now,
      updatedAt: now,
      lastSeenAt: now,
    }, { merge: true });
    if (deviceId) {
      const enabledSnap = await tokensCol.where("enabled", "==", true).get();
      const currentPlatform = String(payload.platform || "");
      const updates = enabledSnap.docs
        .filter((docSnap) => docSnap.id !== tokenHash)
        .filter((docSnap) => {
          const data = docSnap.data() || {};
          const otherDeviceId = String(data.deviceId || "").trim();
          if (otherDeviceId && otherDeviceId === deviceId) return true;
          // Disable legacy tokens (missing deviceId) for same platform to prevent duplicates.
          const otherPlatform = String(data.platform || "");
          if (!otherDeviceId && currentPlatform && otherPlatform === currentPlatform) return true;
          return false;
        })
        .map((docSnap) => docSnap.ref.set({ enabled: false, updatedAt: now }, { merge: true }));
      if (updates.length) await Promise.all(updates);
    }
    // Global cleanup is best-effort: registration must not fail if cross-user queries need indexes.
    try {
      const sameTokenGlobal = await db.collectionGroup("pushTokens").where("token", "==", token).where("enabled", "==", true).get();
      const disableSameTokenElsewhere = sameTokenGlobal.docs
        .filter((docSnap) => docSnap.ref.parent.parent?.id && docSnap.ref.parent.parent.id !== uid)
        .map((docSnap) => docSnap.ref.set({ enabled: false, updatedAt: now }, { merge: true }));
      if (disableSameTokenElsewhere.length) await Promise.all(disableSameTokenElsewhere);

      if (deviceId) {
        const sameDeviceGlobal = await db.collectionGroup("pushTokens").where("deviceId", "==", deviceId).where("enabled", "==", true).get();
        const disableSameDeviceElsewhere = sameDeviceGlobal.docs
          .filter((docSnap) => docSnap.ref.parent.parent?.id && docSnap.ref.parent.parent.id !== uid)
          .map((docSnap) => docSnap.ref.set({ enabled: false, updatedAt: now }, { merge: true }));
        if (disableSameDeviceElsewhere.length) await Promise.all(disableSameDeviceElsewhere);
      }
    } catch (cleanupError) {
      console.warn("push/register global cleanup skipped:", cleanupError?.message || cleanupError);
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("push/register error:", error);
    const message = String(error?.message || "");
    const stack = String(error?.stack || "");
    const code = String(error?.code || "");
    const configFailure =
      message.includes("firebase_admin_env_missing") ||
      message.toLowerCase().includes("private key") ||
      message.includes("DECODER routines") ||
      message.includes("Failed to parse private key") ||
      message.includes("credential implementation provided to initializeApp") ||
      stack.includes("firebaseAdmin");
    if (configFailure) {
      res.status(500).json({ error: "config_error", reason: "admin_init" });
      return;
    }
    if (
      code.includes("auth/") ||
      message.includes("ID token") ||
      message.includes("incorrect \"aud\"") ||
      message.includes("incorrect \"iss\"")
    ) {
      res.status(401).json({ error: "invalid_auth", reason: "verify_id_token" });
      return;
    }
    if (message.includes("Value for argument \"documentPath\"") || message.includes("token")) {
      res.status(400).json({ error: "bad_payload", reason: "token_payload" });
      return;
    }
    res.status(500).json({ error: "internal_error", reason: code || message.slice(0, 80) || "unknown" });
  }
};
