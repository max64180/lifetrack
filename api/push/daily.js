const { getDb, getMessaging } = require("../_lib/firebaseAdmin");

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const explicit = req.headers["x-cron-secret"] || "";
  return bearer === secret || explicit === secret;
}

function computeSummary(deadlines) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let overdue = 0;
  let dueSoon = 0;
  for (const d of deadlines) {
    if (!d || d.done || d.deleted) continue;
    const date = d.date?.toDate ? d.date.toDate() : new Date(d.date);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    date.setHours(0, 0, 0, 0);
    const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
    if (diff < 0) overdue += 1;
    else if (diff <= 3) dueSoon += 1;
  }
  return { overdue, dueSoon };
}

function buildMessage(overdue, dueSoon) {
  if (overdue > 0 && dueSoon > 0) {
    return `Hai ${overdue} scadenze scadute e ${dueSoon} in arrivo.`;
  }
  if (overdue > 0) {
    return `Hai ${overdue} scadenze scadute da gestire.`;
  }
  return `Hai ${dueSoon} scadenze in arrivo nei prossimi giorni.`;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAuthorizedCron(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const db = getDb();
    const messaging = getMessaging();
    const usersSnap = await db.collection("users").get();
    let usersProcessed = 0;
    let sent = 0;
    let disabledTokens = 0;
    const appUrl = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    for (const userDoc of usersSnap.docs) {
      usersProcessed += 1;
      const tokensSnap = await userDoc.ref.collection("pushTokens").where("enabled", "==", true).get();
      if (tokensSnap.empty) continue;
      const deadlinesSnap = await userDoc.ref.collection("deadlines").get();
      const { overdue, dueSoon } = computeSummary(deadlinesSnap.docs.map((d) => d.data()));
      if (overdue === 0 && dueSoon === 0) continue;
      const tokens = tokensSnap.docs.map((d) => d.data()?.token).filter(Boolean);
      if (!tokens.length) continue;

      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: "LifeTrack",
          body: buildMessage(overdue, dueSoon),
        },
        webpush: {
          fcmOptions: {
            link: appUrl ? `${appUrl}/` : "/",
          },
        },
        data: {
          link: appUrl ? `${appUrl}/` : "/",
        },
      });

      sent += response.successCount;
      const invalidHashes = [];
      response.responses.forEach((r, index) => {
        if (r.success) return;
        const code = r.error?.code || "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
          invalidHashes.push(tokensSnap.docs[index]?.id);
        }
      });
      if (invalidHashes.length) {
        await Promise.all(
          invalidHashes.map((id) =>
            userDoc.ref.collection("pushTokens").doc(id).set({
              enabled: false,
              updatedAt: new Date().toISOString(),
            }, { merge: true })
          )
        );
        disabledTokens += invalidHashes.length;
      }
    }

    res.status(200).json({
      ok: true,
      usersProcessed,
      sent,
      disabledTokens,
    });
  } catch (error) {
    console.error("push/daily error:", error);
    res.status(500).json({ error: "internal_error" });
  }
};
