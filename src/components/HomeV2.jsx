import { useMemo, useState } from "react";

const DAY_MS = 86400000;
const INTER_FONT = "'Inter', 'Sora', system-ui, -apple-system, sans-serif";
const SERIF_FONT = "'Playfair Display', 'Cormorant Garamond', Georgia, serif";

const TOKENS = {
  bgPrimary: "#F2EAE3",
  bgCard: "#F7F0EA",
  bgElevated: "#FFFFFF",
  bgAlertSoft: "#F6E9E7",
  textPrimary: "#3F342C",
  textSecondary: "#6F6258",
  textMuted: "#9A8F86",
  textAlert: "#B3473A",
  textIndispensabile: "#A5542A",
  btnPrimaryBg: "#6E8C99",
  btnPrimaryText: "#FFFFFF",
  btnSecondaryBg: "#E9E1DA",
  btnSecondaryText: "#5C5148",
  statusOverdue: "#B3473A",
  statusToday: "#6E8C99",
  statusUpcoming: "#C6A14A",
  statusNeutral: "#CFC6BE",
  borderLight: "#DDD3CA",
  borderSoft: "#E7DED6",
};

const SHADOW_CARD = "0 6px 18px rgba(90, 70, 50, 0.08)";

function startOfDay(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDayDiff(date, today) {
  return Math.round((startOfDay(date) - today) / DAY_MS);
}

function formatDateShort(value, locale) {
  return startOfDay(value).toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

function lineCount(overdueCount, todayCount, next7Count, t) {
  const parts = [];
  if (overdueCount > 0) {
    parts.push(
      t("home.summary.overdue", {
        count: overdueCount,
        defaultValue: overdueCount === 1 ? "1 scaduta" : `${overdueCount} scadute`,
      }),
    );
  }
  if (todayCount > 0) {
    parts.push(
      t("home.summary.today", {
        count: todayCount,
        defaultValue: todayCount === 1 ? "1 oggi" : `${todayCount} oggi`,
      }),
    );
  }
  if (next7Count > 0) {
    parts.push(
      t("home.summary.next7", {
        count: next7Count,
        defaultValue: next7Count === 1 ? "1 nei prossimi giorni" : `${next7Count} nei prossimi giorni`,
      }),
    );
  }
  return parts.join(" · ");
}

function SectionTitle({ label }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontFamily: INTER_FONT,
          fontSize: 14,
          lineHeight: "20px",
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          color: TOKENS.textSecondary,
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </h3>
      <span style={{ height: 1, flex: 1, background: TOKENS.borderLight }} />
    </div>
  );
}

function MoreButton({ expanded, onToggle, t }) {
  return (
    <button
      onClick={onToggle}
      style={{
        marginTop: 4,
        border: "none",
        background: "transparent",
        fontFamily: INTER_FONT,
        fontSize: 13,
        lineHeight: "18px",
        fontWeight: 500,
        color: TOKENS.textSecondary,
        cursor: "pointer",
        padding: 0,
      }}
    >
      {expanded
        ? t("home.showLess", { defaultValue: "Mostra meno" })
        : t("home.showMore", { defaultValue: "Mostra altro" })}
    </button>
  );
}

function Amount({ item, formatNumber, t }) {
  return item.estimateMissing ? t("home.toEstimate", { defaultValue: "Da stimare" }) : `€${formatNumber(item.budget)}`;
}

function ActionButton({ label, primary, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${primary ? TOKENS.btnPrimaryBg : TOKENS.borderLight}`,
        borderRadius: 14,
        background: primary ? TOKENS.btnPrimaryBg : TOKENS.btnSecondaryBg,
        color: primary ? TOKENS.btnPrimaryText : TOKENS.btnSecondaryText,
        minWidth: 96,
        padding: "8px 12px",
        fontFamily: INTER_FONT,
        fontSize: 15,
        lineHeight: "20px",
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DeadlineRow({ item, locale, formatNumber, onComplete, onPostpone, t, withPostpone = false }) {
  return (
    <div
      style={{
        border: `1px solid ${TOKENS.borderSoft}`,
        borderRadius: 14,
        background: TOKENS.bgElevated,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: INTER_FONT,
            fontSize: 16,
            lineHeight: "22px",
            fontWeight: 500,
            color: TOKENS.textPrimary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatDateShort(item.date, locale)} · {item.title}
        </div>
        {withPostpone && (
          <div
            style={{
              marginTop: 4,
              fontFamily: INTER_FONT,
              fontSize: 14,
              lineHeight: "20px",
              color: TOKENS.textSecondary,
            }}
          >
            {t("home.hero.oneOverdueAgo", {
              defaultValue: "Scaduta {{days}} giorni fa",
              days: Math.abs(item.dayDiff),
            })}
          </div>
        )}
        <div
          style={{
            marginTop: 2,
            fontFamily: INTER_FONT,
            fontSize: 16,
            lineHeight: "22px",
            color: TOKENS.textPrimary,
          }}
        >
          <Amount item={item} formatNumber={formatNumber} t={t} />
        </div>
      </div>
      <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
        <ActionButton
          label={t("home.markDone", { defaultValue: "Segna fatto" })}
          primary
          onClick={() => onComplete(item.id)}
        />
        {withPostpone && (
          <ActionButton
            label={t("actions.postpone")}
            onClick={() => onPostpone(item.id)}
          />
        )}
      </div>
    </div>
  );
}

function FutureRow({ item, locale, formatNumber, t, withAction = false, onComplete, compact = false }) {
  return (
    <div
      style={{
        borderTop: `1px solid ${TOKENS.borderSoft}`,
        padding: "12px 0",
        display: "grid",
        gridTemplateColumns: withAction ? "1fr auto" : "1fr auto",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: INTER_FONT,
            fontSize: 16,
            lineHeight: "22px",
            fontWeight: 500,
            color: TOKENS.textPrimary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatDateShort(item.date, locale)} · {item.title}
        </div>
        {!compact && (
          <div
            style={{
              marginTop: 2,
              fontFamily: INTER_FONT,
              fontSize: 16,
              lineHeight: "22px",
              color: TOKENS.textPrimary,
            }}
          >
            <Amount item={item} formatNumber={formatNumber} t={t} />
          </div>
        )}
      </div>
      {withAction ? (
        <ActionButton
          label={t("home.markDone", { defaultValue: "Segna fatto" })}
          primary
          onClick={() => onComplete(item.id)}
        />
      ) : (
        <div
          style={{
            fontFamily: INTER_FONT,
            fontSize: 16,
            lineHeight: "22px",
            color: TOKENS.textSecondary,
            whiteSpace: "nowrap",
          }}
        >
          <Amount item={item} formatNumber={formatNumber} t={t} />
        </div>
      )}
    </div>
  );
}

export default function HomeV2({ deadlines, t, locale, formatNumber, onComplete, onPostpone }) {
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
  const upcomingCount = todayCount + next7Count;

  const hasOverdue = overdueCount > 0;
  const hasUpcoming = upcomingCount > 0;

  let heroNumber = 0;
  let heroTitle = t("home.hero.calm", { defaultValue: "Puoi stare tranquillo" });
  let heroSubtitle = t("home.hero.calmHint", { defaultValue: "Non hai scadenze nei prossimi 7 giorni" });
  let heroTone = "calm";

  if (!hasOverdue && hasUpcoming) {
    heroTone = "upcoming";
    heroNumber = upcomingCount;
    heroTitle = t("home.hero.think", { defaultValue: "E il momento di pensarci" });
    heroSubtitle = lineCount(0, todayCount, next7Count, t);
  } else if (hasOverdue && !hasUpcoming) {
    heroTone = "overdue";
    heroNumber = overdueCount;
    heroTitle = t("home.hero.fix", { defaultValue: "C'e qualcosa da sistemare" });
    heroSubtitle = overdueCount === 1
      ? t("home.hero.oneOverdueAgo", {
          defaultValue: "Scaduta {{days}} giorni fa",
          days: Math.abs(data.overdue[0].dayDiff),
        })
      : t("home.hero.manyOverdue", {
          defaultValue: "{{count}} scadute recenti",
          count: overdueCount,
        });
  } else if (hasOverdue && hasUpcoming) {
    heroTone = "attention";
    heroNumber = overdueCount + upcomingCount;
    heroTitle = t("home.hero.attention", { defaultValue: "Serve un attimo di attenzione" });
    heroSubtitle = lineCount(overdueCount, todayCount, next7Count, t);
  }

  const heroNextLine = !data.nextFuture
    ? t("home.hero.noNext", { defaultValue: "Nessuna prossima scadenza" })
    : data.nextFuture.dayDiff === 0
      ? t("home.hero.nextToday", { defaultValue: "Prossima oggi" })
      : t("home.hero.nextInDays", {
          defaultValue: "Prossima tra {{days}} giorni",
          days: data.nextFuture.dayDiff,
        });

  const heroToneStyles = {
    calm: {
      number: TOKENS.statusNeutral,
      title: TOKENS.textSecondary,
      card: TOKENS.bgCard,
      subtitle: TOKENS.textSecondary,
      line: TOKENS.borderLight,
    },
    upcoming: {
      number: TOKENS.statusUpcoming,
      title: TOKENS.textIndispensabile,
      card: "#F8EEE3",
      subtitle: TOKENS.textSecondary,
      line: TOKENS.borderLight,
    },
    overdue: {
      number: TOKENS.statusOverdue,
      title: TOKENS.textAlert,
      card: TOKENS.bgAlertSoft,
      subtitle: TOKENS.textSecondary,
      line: TOKENS.borderLight,
    },
    attention: {
      number: TOKENS.textIndispensabile,
      title: TOKENS.textIndispensabile,
      card: "#F8EFE7",
      subtitle: TOKENS.textSecondary,
      line: TOKENS.borderLight,
    },
  }[heroTone];

  const rootStyle = {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px 104px",
    background: TOKENS.bgPrimary,
    position: "relative",
    fontFamily: INTER_FONT,
  };

  const sectionCardStyle = {
    border: `1px solid ${TOKENS.borderSoft}`,
    borderRadius: 20,
    background: TOKENS.bgCard,
    boxShadow: SHADOW_CARD,
    padding: 16,
    marginBottom: 28,
  };

  const compactRows = { display: "grid", gap: 10 };
  const todaySlice = showAllToday ? data.todayItems : data.todayItems.slice(0, 3);
  const next7Slice = showAllNext7 ? data.next7 : data.next7.slice(0, 3);
  const overdueSlice = showAllOverdue ? data.overdue : data.overdue.slice(0, 3);

  return (
    <div style={rootStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@500;600&display=swap');
      `}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "radial-gradient(rgba(120, 98, 76, 0.08) 0.4px, transparent 0.4px), radial-gradient(rgba(120, 98, 76, 0.06) 0.5px, transparent 0.5px)",
          backgroundSize: "3px 3px, 5px 5px",
          opacity: 0.42,
        }}
      />

      <div style={{ position: "relative", zIndex: 1, display: "grid", gap: 0 }}>
        <div
          style={{
            border: `1px solid ${TOKENS.borderSoft}`,
            borderRadius: 20,
            background: heroToneStyles.card,
            boxShadow: SHADOW_CARD,
            overflow: "hidden",
            marginBottom: 24,
          }}
        >
          <div style={{ padding: 20 }}>
            <div
              style={{
                textAlign: "center",
                fontFamily: SERIF_FONT,
                fontWeight: 600,
                fontSize: 48,
                lineHeight: "52px",
                color: heroToneStyles.number,
              }}
            >
              {heroNumber}
            </div>
            <div style={{ marginTop: 4, textAlign: "center", fontFamily: SERIF_FONT, fontWeight: 500, fontSize: 22, lineHeight: "28px", color: heroToneStyles.title }}>
              {heroTitle}
            </div>
            <div
              style={{
                marginTop: 8,
                textAlign: "center",
                fontFamily: INTER_FONT,
                fontWeight: 400,
                fontSize: 16,
                lineHeight: "22px",
                color: heroToneStyles.subtitle,
              }}
            >
              {heroSubtitle}
            </div>
          </div>

          <div
            style={{
              borderTop: `1px solid ${heroToneStyles.line}`,
              background: "rgba(255, 255, 255, 0.38)",
              padding: "12px 8px",
              textAlign: "center",
              fontFamily: INTER_FONT,
              fontWeight: 400,
              fontSize: 16,
              lineHeight: "22px",
              color: TOKENS.textSecondary,
            }}
          >
            {heroNextLine}
          </div>
        </div>

        {overdueCount > 0 && (
          <section style={{ marginBottom: 24 }}>
            <SectionTitle label={t("tabs.overdue")} />
            <div style={{ ...sectionCardStyle, background: TOKENS.bgAlertSoft }}>
              <div
                style={{
                  fontFamily: INTER_FONT,
                  fontWeight: 500,
                  fontSize: 13,
                  lineHeight: "18px",
                  color: TOKENS.textSecondary,
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                {t("tabs.overdue")}
              </div>
              <div style={compactRows}>
                {overdueSlice.map((item) => (
                  <DeadlineRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    formatNumber={formatNumber}
                    onComplete={onComplete}
                    onPostpone={onPostpone}
                    withPostpone
                    t={t}
                  />
                ))}
              </div>
              {overdueCount > 3 && (
                <MoreButton expanded={showAllOverdue} onToggle={() => setShowAllOverdue((v) => !v)} t={t} />
              )}
            </div>
          </section>
        )}

        {todayCount > 0 && (
          <section style={{ marginBottom: 24 }}>
            <SectionTitle label={t("home.todaySection", { defaultValue: "In scadenza oggi" })} />
            <div style={sectionCardStyle}>
              <div style={{ border: `1px solid ${TOKENS.borderSoft}`, borderRadius: 14, background: TOKENS.bgElevated, padding: "0 14px" }}>
                {todaySlice.map((item, idx) => (
                  <div key={item.id} style={{ borderTop: idx === 0 ? "none" : `1px solid ${TOKENS.borderSoft}` }}>
                    <FutureRow
                      item={item}
                      locale={locale}
                      formatNumber={formatNumber}
                      withAction
                      onComplete={onComplete}
                      t={t}
                    />
                  </div>
                ))}
              </div>
              {todayCount > 3 && (
                <MoreButton expanded={showAllToday} onToggle={() => setShowAllToday((v) => !v)} t={t} />
              )}
            </div>
          </section>
        )}

        {next7Count > 0 && (
          <section style={{ marginBottom: 24 }}>
            <SectionTitle label={t("home.next7Section", { defaultValue: "Nei prossimi 7 giorni" })} />
            <div style={sectionCardStyle}>
              <div style={{ border: `1px solid ${TOKENS.borderSoft}`, borderRadius: 14, background: TOKENS.bgElevated, padding: "0 14px" }}>
                {next7Slice.map((item, idx) => (
                  <div key={item.id} style={{ borderTop: idx === 0 ? "none" : `1px solid ${TOKENS.borderSoft}` }}>
                    <FutureRow
                      item={item}
                      locale={locale}
                      formatNumber={formatNumber}
                      withAction
                      onComplete={onComplete}
                      t={t}
                    />
                  </div>
                ))}
              </div>
              {next7Count > 3 && (
                <MoreButton expanded={showAllNext7} onToggle={() => setShowAllNext7((v) => !v)} t={t} />
              )}
            </div>
          </section>
        )}

        {data.incoming.length > 0 && (
          <section style={{ marginBottom: 12 }}>
            <SectionTitle label={t("home.incomingSection", { defaultValue: "In arrivo" })} />
            <div style={sectionCardStyle}>
              <div
                style={{
                  border: `1px solid ${TOKENS.borderSoft}`,
                  borderRadius: 14,
                  background: TOKENS.bgElevated,
                  overflow: "hidden",
                  padding: "0 14px",
                }}
              >
                {data.incoming.map((item, idx) => (
                  <div key={item.id} style={{ borderTop: idx === 0 ? "none" : `1px solid ${TOKENS.borderSoft}` }}>
                    <FutureRow
                      item={item}
                      locale={locale}
                      formatNumber={formatNumber}
                      compact
                      t={t}
                    />
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
