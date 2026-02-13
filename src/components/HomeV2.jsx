import { useMemo, useState } from "react";

const DAY_MS = 86400000;

function startOfDay(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDayDiff(date, today) {
  return Math.round((startOfDay(date) - today) / DAY_MS);
}

function toLineCount(overdueCount, todayCount, next7Count, t) {
  return [
    overdueCount > 0 ? t("tabs.overdue") : null,
    todayCount > 0 ? t("home.today", { defaultValue: "oggi" }) : null,
    next7Count > 0 ? t("home.inNextDays", { defaultValue: "nei prossimi giorni" }) : null,
  ].filter(Boolean).join(" · ");
}

export default function HomeV2({
  deadlines,
  t,
  locale,
  formatNumber,
  onComplete,
  onPostpone,
}) {
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [showAllToday, setShowAllToday] = useState(false);
  const [showAllNext7, setShowAllNext7] = useState(false);

  const data = useMemo(() => {
    const today = startOfDay(new Date());
    const pendingManual = (deadlines || [])
      .filter((d) => !d.done && !d.deleted && !d.skipped && !d.autoPay)
      .map((d) => ({ ...d, dayDiff: getDayDiff(d.date, today) }))
      .sort((a, b) => a.date - b.date);

    const overdue = pendingManual.filter((d) => d.dayDiff < 0 && d.dayDiff >= -7);
    const todayItems = pendingManual.filter((d) => d.dayDiff === 0);
    const next7 = pendingManual.filter((d) => d.dayDiff > 0 && d.dayDiff <= 7);
    const incoming = pendingManual.filter((d) => d.dayDiff > 7).slice(0, 8);
    const nextFuture = pendingManual.find((d) => d.dayDiff >= 0) || null;
    return { overdue, todayItems, next7, incoming, nextFuture };
  }, [deadlines]);

  const overdueCount = data.overdue.length;
  const todayCount = data.todayItems.length;
  const next7Count = data.next7.length;
  const hasOverdue = overdueCount > 0;
  const hasUpcoming = todayCount + next7Count > 0;

  let heroNumber = 0;
  let heroTitle = t("home.hero.calm", { defaultValue: "Puoi stare tranquillo" });
  let heroSubtitle = t("home.hero.calmHint", { defaultValue: "Non hai scadenze nei prossimi 7 giorni" });
  let heroTone = "calm";

  if (!hasOverdue && hasUpcoming) {
    heroTone = "upcoming";
    heroNumber = todayCount + next7Count;
    heroTitle = t("home.hero.think", { defaultValue: "È il momento di pensarci" });
    heroSubtitle = t("home.inNext7", { defaultValue: "Nei prossimi 7 giorni" });
  }

  if (hasOverdue && !hasUpcoming) {
    heroTone = "overdue";
    heroNumber = overdueCount;
    heroTitle = t("home.hero.fix", { defaultValue: "C'è qualcosa da sistemare" });
    if (overdueCount === 1) {
      heroSubtitle = t("home.hero.oneOverdueAgo", {
        defaultValue: "Scaduta {{days}} giorni fa",
        days: Math.abs(data.overdue[0].dayDiff),
      });
    } else {
      heroSubtitle = t("home.hero.manyOverdue", {
        defaultValue: "{{count}} scadute recenti",
        count: overdueCount,
      });
    }
  }

  if (hasOverdue && hasUpcoming) {
    heroTone = "attention";
    heroNumber = overdueCount + todayCount + next7Count;
    heroTitle = t("home.hero.attention", { defaultValue: "Serve un attimo di attenzione" });
    heroSubtitle = toLineCount(overdueCount, todayCount, next7Count, t);
  }

  const heroNextLine = !data.nextFuture
    ? t("home.hero.noNext", { defaultValue: "Nessuna prossima scadenza" })
    : data.nextFuture.dayDiff === 0
    ? t("home.hero.nextToday", { defaultValue: "Prossima oggi" })
    : t("home.hero.nextInDays", {
        defaultValue: "Prossima tra {{days}} giorni",
        days: data.nextFuture.dayDiff,
      });

  const toneStyles = {
    calm: { number: "#7f8792", title: "#4e5258", bg: "#fbf9f5", border: "#e8e3da" },
    upcoming: { number: "#b98954", title: "#67463a", bg: "#faf3ea", border: "#eadfce" },
    overdue: { number: "#9c4e4b", title: "#6a3d3c", bg: "#faefef", border: "#ecd8d8" },
    attention: { number: "#ab6a52", title: "#6b4237", bg: "#f9f2eb", border: "#eadbce" },
  }[heroTone];

  const renderRows = (rows, withPostpone = false) => rows.map((item) => (
    <div
      key={item.id}
      style={{
        display: "grid",
        gridTemplateColumns: withPostpone ? "1fr auto" : "1fr auto",
        gap: 8,
        alignItems: "center",
        padding: "8px 10px",
        border: "1px solid #ebe6dc",
        borderRadius: 12,
        marginBottom: 8,
        background: "#fff",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 17, lineHeight: 1.2, color: "#2f2c28", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {startOfDay(item.date).toLocaleDateString(locale, { day: "2-digit", month: "short" })} · {item.title}
        </div>
        {withPostpone && (
          <div style={{ marginTop: 4, fontSize: 14, color: "#857e73" }}>
            {t("home.hero.oneOverdueAgo", { defaultValue: "Scaduta {{days}} giorni fa", days: Math.abs(item.dayDiff) })}
          </div>
        )}
        <div style={{ marginTop: 4, fontSize: 16, color: "#403a33" }}>
          {item.estimateMissing ? t("home.toEstimate", { defaultValue: "Da stimare" }) : `€${formatNumber(item.budget)}`}
        </div>
      </div>
      <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
        <button
          onClick={() => onComplete(item.id)}
          style={{
            border: "1px solid #88a8c3",
            borderRadius: 11,
            background: "#92b4d2",
            color: "#fff",
            minWidth: 92,
            padding: "8px 10px",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          {t("home.markDone", { defaultValue: "Segna fatto" })}
        </button>
        {withPostpone && (
          <button
            onClick={() => onPostpone(item.id)}
            style={{
              border: "1px solid #ddd4c7",
              borderRadius: 11,
              background: "#f7f2ea",
              color: "#5f584f",
              minWidth: 92,
              padding: "8px 10px",
              fontSize: 16,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            {t("actions.postpone")}
          </button>
        )}
      </div>
    </div>
  ));

  const sectionTitleStyle = {
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: 28,
    color: "#2f2b27",
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "0 0 10px",
  };

  const sectionCardStyle = {
    border: "1px solid #e6e0d5",
    borderRadius: 16,
    background: "rgba(255,255,255,.88)",
    boxShadow: "0 10px 22px rgba(30,22,16,.08)",
    padding: 10,
    marginBottom: 16,
    backdropFilter: "blur(1px)",
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 96px", background: "#f7f4ef", fontFamily: "'Source Sans 3', 'Sora', sans-serif", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage: "radial-gradient(rgba(88,66,45,.07) .45px, transparent .45px)",
          backgroundSize: "3px 3px",
          opacity: 0.35,
        }}
      />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{
          border: `1px solid ${toneStyles.border}`,
          borderRadius: 18,
          background: toneStyles.bg,
          boxShadow: "0 10px 22px rgba(30,22,16,.08)",
          marginBottom: 18,
          overflow: "hidden",
        }}>
          <div style={{ padding: "14px 14px 10px" }}>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", textAlign: "center", color: toneStyles.number, fontSize: 74, lineHeight: 0.9 }}>{heroNumber}</div>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", textAlign: "center", color: toneStyles.title, fontSize: 49, lineHeight: 1, marginTop: 8 }}>{heroTitle}</div>
            <div style={{ marginTop: 8, textAlign: "center", color: "#666156", fontSize: 15 }}>{heroSubtitle}</div>
          </div>
          <div style={{ borderTop: "1px solid rgba(100,88,76,.18)", textAlign: "center", padding: "10px 8px", fontSize: 16, color: "#5f584f", background: "rgba(255,255,255,.55)" }}>
            {heroNextLine}
          </div>
        </div>

        {overdueCount > 0 && (
          <section>
            <h3 style={sectionTitleStyle}>
              {t("tabs.overdue").toUpperCase()}
              <span style={{ height: 1, flex: 1, background: "#ddd5c9" }} />
            </h3>
            <div style={sectionCardStyle}>
              <div style={{ fontSize: 13, color: "#7a7367", textTransform: "uppercase", marginBottom: 8 }}>{t("tabs.overdue").toUpperCase()}</div>
              {renderRows(showAllOverdue ? data.overdue : data.overdue.slice(0, 3), true)}
              {data.overdue.length > 3 && (
                <button onClick={() => setShowAllOverdue(v => !v)} style={{ border: "none", background: "transparent", color: "#6f685d", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "2px 4px" }}>
                  {showAllOverdue ? t("home.showLess", { defaultValue: "Mostra meno" }) : t("home.showMore", { defaultValue: "Mostra altro" })}
                </button>
              )}
            </div>
          </section>
        )}

        {todayCount > 0 && (
          <section>
            <h3 style={sectionTitleStyle}>
              {t("home.todaySection", { defaultValue: "In scadenza oggi" }).toUpperCase()}
              <span style={{ height: 1, flex: 1, background: "#ddd5c9" }} />
            </h3>
            <div style={sectionCardStyle}>
              {renderRows(showAllToday ? data.todayItems : data.todayItems.slice(0, 3))}
              {data.todayItems.length > 3 && (
                <button onClick={() => setShowAllToday(v => !v)} style={{ border: "none", background: "transparent", color: "#6f685d", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "2px 4px" }}>
                  {showAllToday ? t("home.showLess", { defaultValue: "Mostra meno" }) : t("home.showMore", { defaultValue: "Mostra altro" })}
                </button>
              )}
            </div>
          </section>
        )}

        {next7Count > 0 && (
          <section>
            <h3 style={sectionTitleStyle}>
              {t("home.next7Section", { defaultValue: "Nei prossimi 7 giorni" }).toUpperCase()}
              <span style={{ height: 1, flex: 1, background: "#ddd5c9" }} />
            </h3>
            <div style={sectionCardStyle}>
              {renderRows(showAllNext7 ? data.next7 : data.next7.slice(0, 3))}
              {data.next7.length > 3 && (
                <button onClick={() => setShowAllNext7(v => !v)} style={{ border: "none", background: "transparent", color: "#6f685d", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "2px 4px" }}>
                  {showAllNext7 ? t("home.showLess", { defaultValue: "Mostra meno" }) : t("home.showMore", { defaultValue: "Mostra altro" })}
                </button>
              )}
            </div>
          </section>
        )}

        {data.incoming.length > 0 && (
          <section>
            <h3 style={sectionTitleStyle}>
              {t("home.incomingSection", { defaultValue: "In arrivo" }).toUpperCase()}
              <span style={{ height: 1, flex: 1, background: "#ddd5c9" }} />
            </h3>
            <div style={sectionCardStyle}>
              <div style={{ border: "1px solid #ebe6dc", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
                {data.incoming.map((item, idx) => (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: "10px 12px", borderTop: idx === 0 ? "none" : "1px solid #f0ebe2" }}>
                    <div style={{ minWidth: 0, fontSize: 17, color: "#38332c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {startOfDay(item.date).toLocaleDateString(locale, { day: "2-digit", month: "short" })} · {item.title}
                    </div>
                    <div style={{ fontSize: 17, color: "#5a5248" }}>
                      {item.estimateMissing ? t("home.toEstimate", { defaultValue: "Da stimare" }) : `€${formatNumber(item.budget)}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
