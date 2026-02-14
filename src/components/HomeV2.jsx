import { useMemo, useState } from "react";

const DAY_MS = 86400000;
const INTER_FONT = "'Inter', 'Sora', system-ui, -apple-system, sans-serif";
const TITLE_FONT = "'Sora', 'Inter', system-ui, -apple-system, sans-serif";

const TOKENS = {
  bgRoot: "#ECE9E6",
  topBg: "#1B1712",
  topBg2: "#151411",
  heroBg: "#2D2A26",
  heroBg2: "#27241F",
  bgCard: "#FFFFFF",
  bgOverdueCard: "#FFF7F4",
  bgInner: "#FAF8F6",
  textOnDark: "#F7F5F2",
  textOnDarkMuted: "#B6AEA4",
  textPrimary: "#2B2621",
  textSecondary: "#6D655D",
  textMuted: "#8F857C",
  textAlert: "#E06D50",
  textInfo: "#5B8DD9",
  border: "#DED7D0",
  borderSoft: "#E7E0D9",
  borderDark: "#3C3732",
  btnPrimaryBg: "#5B8DD9",
  btnPrimaryText: "#FFFFFF",
  btnOverdueBg: "#E8855D",
  btnSecondaryBg: "#F0E7DF",
  btnSecondaryText: "#60574F",
  statusOverdue: "#E8855D",
  statusToday: "#5B8DD9",
  statusUpcoming: "#3CA06A",
  statusNeutral: "#9AA2AE",
};

const SHADOW_CARD = "0 8px 20px rgba(62, 42, 31, 0.12)";
const SHADOW_HERO = "0 12px 24px rgba(20, 16, 12, 0.35)";

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
        defaultValue: next7Count === 1 ? "1 nei prossimi 7 giorni" : `${next7Count} nei prossimi 7 giorni`,
      }),
    );
  }
  return parts.join(" - ");
}

function SectionTitle({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <h3
        style={{
          margin: 0,
          fontFamily: TITLE_FONT,
          fontSize: 17,
          lineHeight: "22px",
          letterSpacing: "0.2px",
          color: TOKENS.textPrimary,
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </h3>
      <span style={{ height: 1, flex: 1, background: TOKENS.border }} />
    </div>
  );
}

function MoreButton({ expanded, onToggle, t }) {
  return (
    <button
      onClick={onToggle}
      style={{
        marginTop: 8,
        border: "none",
        background: "transparent",
        fontFamily: INTER_FONT,
        fontSize: 13,
        lineHeight: "18px",
        fontWeight: 700,
        color: TOKENS.textMuted,
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

function ActionButton({ label, primary, onClick, overdueTone = false }) {
  const isPrimary = !!primary;
  const bg = isPrimary ? (overdueTone ? TOKENS.btnOverdueBg : TOKENS.btnPrimaryBg) : TOKENS.btnSecondaryBg;
  const border = isPrimary ? bg : TOKENS.border;
  const color = isPrimary ? TOKENS.btnPrimaryText : TOKENS.btnSecondaryText;

  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${border}`,
        borderRadius: 14,
        background: bg,
        color,
        minWidth: isPrimary ? 102 : 90,
        padding: "8px 12px",
        fontFamily: TITLE_FONT,
        fontSize: 13,
        lineHeight: "16px",
        fontWeight: 700,
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
        background: TOKENS.bgCard,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: TITLE_FONT,
            fontSize: 17,
            lineHeight: "22px",
            fontWeight: 700,
            color: TOKENS.textPrimary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatDateShort(item.date, locale)} - {item.title}
        </div>
        {withPostpone && (
          <div
            style={{
              marginTop: 4,
              fontFamily: INTER_FONT,
              fontSize: 14,
              lineHeight: "19px",
              color: "#8A6255",
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
            marginTop: 4,
            fontFamily: TITLE_FONT,
            fontSize: 16,
            lineHeight: "20px",
            color: TOKENS.textPrimary,
            fontWeight: 700,
          }}
        >
          <Amount item={item} formatNumber={formatNumber} t={t} />
        </div>
      </div>
      <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
        <ActionButton
          label={t("home.markDone", { defaultValue: "Segna fatto" })}
          primary
          overdueTone={withPostpone}
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
        padding: compact ? "10px 0" : "12px 0",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: TITLE_FONT,
            fontSize: 17,
            lineHeight: "22px",
            fontWeight: 700,
            color: TOKENS.textPrimary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatDateShort(item.date, locale)} - {item.title}
        </div>
        {!compact && (
          <div
            style={{
              marginTop: 4,
              fontFamily: INTER_FONT,
              fontSize: 15,
              lineHeight: "20px",
              color: TOKENS.textSecondary,
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
            fontSize: 15,
            lineHeight: "20px",
            color: TOKENS.textSecondary,
            whiteSpace: "nowrap",
            fontWeight: 600,
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
  let heroSubtitle = t("home.hero.calmHint", { defaultValue: "Nessuna scadenza nei prossimi 7 giorni" });
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
      title: TOKENS.textOnDark,
      subtitle: TOKENS.textOnDarkMuted,
      accentA: "#7E7E87",
      accentB: "#6F7682",
      accentC: "#5D646E",
      line: TOKENS.borderDark,
      next: "#D7CDBF",
    },
    upcoming: {
      number: TOKENS.statusUpcoming,
      title: "#F7E8CB",
      subtitle: TOKENS.textOnDarkMuted,
      accentA: "#C6A14A",
      accentB: "#6EA277",
      accentC: "#5E7E9C",
      line: TOKENS.borderDark,
      next: "#E8A074",
    },
    overdue: {
      number: TOKENS.statusOverdue,
      title: "#F3C0B2",
      subtitle: TOKENS.textOnDarkMuted,
      accentA: "#E8855D",
      accentB: "#A45F4D",
      accentC: "#5E7E9C",
      line: TOKENS.borderDark,
      next: "#E8A074",
    },
    attention: {
      number: TOKENS.statusOverdue,
      title: "#F4D7CD",
      subtitle: TOKENS.textOnDarkMuted,
      accentA: "#E8855D",
      accentB: "#5B8DD9",
      accentC: "#3CA06A",
      line: TOKENS.borderDark,
      next: "#E8A074",
    },
  }[heroTone];

  const todaySlice = showAllToday ? data.todayItems : data.todayItems.slice(0, 3);
  const next7Slice = showAllNext7 ? data.next7 : data.next7.slice(0, 3);
  const overdueSlice = showAllOverdue ? data.overdue : data.overdue.slice(0, 3);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: TOKENS.bgRoot }}>
      <div
        style={{
          background: `linear-gradient(180deg, ${TOKENS.topBg2} 0%, ${TOKENS.topBg} 100%)`,
          padding: "6px 16px 18px",
        }}
      >
        <div
          style={{
            border: `1px solid ${TOKENS.borderDark}`,
            borderRadius: 24,
            background: `linear-gradient(180deg, ${TOKENS.heroBg} 0%, ${TOKENS.heroBg2} 100%)`,
            boxShadow: SHADOW_HERO,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "14px 16px 12px" }}>
            <div
              style={{
                fontFamily: INTER_FONT,
                fontSize: 13,
                lineHeight: "18px",
                fontWeight: 700,
                letterSpacing: "0.9px",
                color: TOKENS.textOnDarkMuted,
                textTransform: "uppercase",
              }}
            >
              {heroTitle}
            </div>

            <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
              <div
                style={{
                  fontFamily: TITLE_FONT,
                  fontSize: 52,
                  lineHeight: "56px",
                  color: heroToneStyles.number,
                  fontWeight: 800,
                  letterSpacing: "-1px",
                }}
              >
                {heroNumber}
              </div>
              <div
                style={{
                  fontFamily: INTER_FONT,
                  fontSize: 15,
                  lineHeight: "22px",
                  color: heroToneStyles.subtitle,
                }}
              >
                {t("home.hero.totalItems", { defaultValue: "totale item attivi" })}
              </div>
            </div>

            <div
              style={{
                marginTop: 8,
                fontFamily: INTER_FONT,
                fontSize: 15,
                lineHeight: "20px",
                color: heroToneStyles.subtitle,
              }}
            >
              {heroSubtitle}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <span style={{ height: 6, borderRadius: 999, background: heroToneStyles.accentA, width: 64 }} />
              <span style={{ height: 6, borderRadius: 999, background: heroToneStyles.accentB, width: 64 }} />
              <span style={{ height: 6, borderRadius: 999, background: heroToneStyles.accentC, width: 64 }} />
            </div>
          </div>

          <div
            style={{
              borderTop: `1px solid ${heroToneStyles.line}`,
              padding: "12px 10px",
              textAlign: "center",
              fontFamily: INTER_FONT,
              fontWeight: 700,
              fontSize: 16,
              lineHeight: "20px",
              color: heroToneStyles.next,
            }}
          >
            {heroNextLine}
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 16px 116px" }}>
        {overdueCount > 0 && (
          <section style={{ marginBottom: 20 }}>
            <SectionTitle label={t("home.overdueRecent", { defaultValue: "Scadute (ultimi 7 giorni)" })} />
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 20,
                background: TOKENS.bgOverdueCard,
                boxShadow: SHADOW_CARD,
                padding: 12,
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
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
          <section style={{ marginBottom: 20 }}>
            <SectionTitle label={t("home.todaySection", { defaultValue: "In scadenza oggi" })} />
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 20,
                background: TOKENS.bgCard,
                boxShadow: SHADOW_CARD,
                padding: 12,
              }}
            >
              <div style={{ border: `1px solid ${TOKENS.borderSoft}`, borderRadius: 14, background: TOKENS.bgInner, padding: "0 12px" }}>
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
          <section style={{ marginBottom: 20 }}>
            <SectionTitle label={t("home.next7Section", { defaultValue: "Nei prossimi 7 giorni" })} />
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 20,
                background: TOKENS.bgCard,
                boxShadow: SHADOW_CARD,
                padding: 12,
              }}
            >
              <div style={{ border: `1px solid ${TOKENS.borderSoft}`, borderRadius: 14, background: TOKENS.bgInner, padding: "0 12px" }}>
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
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 20,
                background: TOKENS.bgCard,
                boxShadow: SHADOW_CARD,
                padding: 12,
              }}
            >
              <div
                style={{
                  border: `1px solid ${TOKENS.borderSoft}`,
                  borderRadius: 14,
                  background: TOKENS.bgInner,
                  overflow: "hidden",
                  padding: "0 12px",
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
