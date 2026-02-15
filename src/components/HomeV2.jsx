import { useMemo, useState } from "react";

const DAY_MS = 86400000;
const INTER_FONT = "'Inter', system-ui, -apple-system, sans-serif";
const TITLE_FONT = "'Playfair Display', 'Cormorant Garamond', Georgia, serif";
const DISPLAY_FONT = "'Playfair Display', 'Cormorant Garamond', Georgia, serif";

const TOKENS = {
  bgRoot: "#E6DBCF",
  bgRootWarm: "#DCCFC1",
  topBg: "#3A2D24",
  topBg2: "#30251E",
  heroBg: "#4A3A2F",
  heroBg2: "#403229",
  bgCard: "#F7F0EA",
  bgOverdueCard: "#F6E9E7",
  bgInner: "#FFFDFB",
  textOnDark: "#F6EFE8",
  textOnDarkMuted: "#D5C8BB",
  textPrimary: "#3F342C",
  textSecondary: "#6F6258",
  textMuted: "#9A8F86",
  textAlert: "#B3473A",
  textInfo: "#6E8C99",
  border: "#DDD3CA",
  borderSoft: "#E7DED6",
  borderDark: "#5A493D",
  btnPrimaryBg: "#6E8C99",
  btnPrimaryText: "#FFFFFF",
  btnOverdueBg: "#B3473A",
  btnSecondaryBg: "#E9E1DA",
  btnSecondaryText: "#5C5148",
  statusOverdue: "#B3473A",
  statusToday: "#6E8C99",
  statusUpcoming: "#C6A14A",
  statusNeutral: "#CFC6BE",
};

const SHADOW_CARD = "0 6px 18px rgba(90, 70, 50, 0.08)";
const SHADOW_HERO = "0 10px 24px rgba(66, 48, 34, 0.20)";

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
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <h3
        style={{
          margin: 0,
          fontFamily: DISPLAY_FONT,
          fontSize: 18,
          lineHeight: "23px",
          letterSpacing: "0.4px",
          color: TOKENS.textPrimary,
          fontWeight: 500,
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
        marginTop: 6,
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
  const bg = isPrimary
    ? (overdueTone ? "rgba(179,71,58,0.06)" : "rgba(110,140,153,0.08)")
    : "rgba(255,255,255,0.32)";
  const border = isPrimary
    ? (overdueTone ? "rgba(139,62,52,0.35)" : "rgba(79,107,118,0.32)")
    : "rgba(111,98,88,0.22)";
  const color = isPrimary
    ? (overdueTone ? "#7B3A31" : "#47626C")
    : "#64594F";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        border: `1px solid ${border}`,
        borderRadius: 12,
        background: bg,
        color,
        minWidth: isPrimary ? 90 : 82,
        padding: "6px 11px",
        fontFamily: INTER_FONT,
        fontSize: 14,
        lineHeight: "19px",
        fontWeight: 500,
        letterSpacing: "0.1px",
        cursor: "pointer",
        boxShadow: "none",
        backdropFilter: "blur(1.5px)",
      }}
    >
      {label}
    </button>
  );
}

function DeadlineRow({ item, locale, formatNumber, onComplete, onPostpone, onOpenItem, t, withPostpone = false }) {
  return (
    <div
      onClick={() => onOpenItem && onOpenItem(item)}
      style={{
        border: `1px solid ${TOKENS.borderSoft}`,
        borderRadius: 14,
        background: TOKENS.bgInner,
        padding: 10,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 8,
        alignItems: "center",
        cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 17,
            lineHeight: "23px",
            fontWeight: 500,
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
              marginTop: 3,
              fontFamily: INTER_FONT,
              fontSize: 14,
              lineHeight: "18px",
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
            marginTop: 3,
            fontFamily: INTER_FONT,
            fontSize: 16,
            lineHeight: "22px",
            color: TOKENS.textPrimary,
            fontWeight: 500,
          }}
        >
          <Amount item={item} formatNumber={formatNumber} t={t} />
        </div>
      </div>
      <div style={{ display: "grid", gap: 7, justifyItems: "end" }}>
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
      {activeItem && (
        <div
          onClick={() => setActiveItem(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,22,18,0.45)",
            zIndex: 240,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "16px",
            backdropFilter: "blur(3px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              borderRadius: 18,
              border: `1px solid ${TOKENS.border}`,
              background: TOKENS.bgCard,
              boxShadow: SHADOW_CARD,
              padding: 14,
            }}
          >
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, lineHeight: "28px", color: TOKENS.textPrimary, fontWeight: 500 }}>
              {activeItem.title}
            </div>
            <div style={{ marginTop: 4, fontFamily: INTER_FONT, fontSize: 14, color: TOKENS.textSecondary }}>
              {startOfDay(activeItem.date).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
              {activeItem.asset ? ` · ${activeItem.asset}` : ""}
            </div>
            <div style={{ marginTop: 8, fontFamily: INTER_FONT, fontSize: 22, fontWeight: 600, color: TOKENS.textPrimary }}>
              <Amount item={activeItem} formatNumber={formatNumber} t={t} />
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ActionButton
                label={t("home.markDone", { defaultValue: "Segna fatto" })}
                primary
                overdueTone={activeItem.dayDiff < 0}
                onClick={() => { onComplete(activeItem.id); setActiveItem(null); }}
              />
              <ActionButton
                label={t("actions.postpone", { defaultValue: "Posticipa" })}
                onClick={() => { onPostpone(activeItem.id); setActiveItem(null); }}
              />
            </div>
            <button
              onClick={() => setActiveItem(null)}
              style={{
                marginTop: 10,
                width: "100%",
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 12,
                background: "rgba(255,255,255,0.45)",
                color: TOKENS.textSecondary,
                fontFamily: INTER_FONT,
                fontSize: 14,
                fontWeight: 500,
                padding: "8px 10px",
                cursor: "pointer",
              }}
            >
              {t("actions.close", { defaultValue: "Chiudi" })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FutureRow({ item, locale, formatNumber, t, withAction = false, onComplete, onOpenItem, compact = false }) {
  return (
    <div
      onClick={() => onOpenItem && onOpenItem(item)}
      style={{
        borderTop: `1px solid ${TOKENS.borderSoft}`,
        padding: compact ? "8px 0" : "10px 0",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "center",
        cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 17,
            lineHeight: "23px",
            fontWeight: 500,
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
              marginTop: 3,
              fontFamily: INTER_FONT,
              fontSize: 14,
              lineHeight: "18px",
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
            fontSize: 14,
            lineHeight: "18px",
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
  const [activeItem, setActiveItem] = useState(null);

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
      title: "#F6E6C9",
      subtitle: TOKENS.textOnDarkMuted,
      accentA: "#C6A14A",
      accentB: "#A98955",
      accentC: "#7E6B5A",
      line: TOKENS.borderDark,
      next: "#E4B88D",
    },
    overdue: {
      number: TOKENS.statusOverdue,
      title: "#F2CEC6",
      subtitle: TOKENS.textOnDarkMuted,
      accentA: "#B3473A",
      accentB: "#9C5C4B",
      accentC: "#7E6B5A",
      line: TOKENS.borderDark,
      next: "#E4B88D",
    },
    attention: {
      number: TOKENS.statusOverdue,
      title: "#F3D4CA",
      subtitle: TOKENS.textOnDarkMuted,
      accentA: "#B3473A",
      accentB: "#6E8C99",
      accentC: "#C6A14A",
      line: TOKENS.borderDark,
      next: "#E4B88D",
    },
  }[heroTone];

  const todaySlice = showAllToday ? data.todayItems : data.todayItems.slice(0, 3);
  const next7Slice = showAllNext7 ? data.next7 : data.next7.slice(0, 3);
  const overdueSlice = showAllOverdue ? data.overdue : data.overdue.slice(0, 3);

  const openInHome = (item) => setActiveItem(item || null);

  return (
    <div style={{
      flex: 1,
      overflowY: "auto",
      backgroundColor: TOKENS.bgRoot,
      backgroundImage: `
        radial-gradient(120% 90% at 50% -10%, rgba(42,31,24,0.55) 0%, rgba(42,31,24,0) 46%),
        radial-gradient(70% 40% at 20% 25%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%),
        radial-gradient(80% 45% at 85% 30%, rgba(120,95,74,0.09) 0%, rgba(120,95,74,0) 72%),
        linear-gradient(180deg, ${TOKENS.bgRootWarm} 0%, ${TOKENS.bgRoot} 100%)`
    }}>
      <div
        style={{
          padding: "6px 16px 18px",
        }}
      >
        <div
          style={{
            border: `1px solid ${TOKENS.borderDark}`,
            borderRadius: 22,
            background: `linear-gradient(180deg, ${TOKENS.heroBg} 0%, ${TOKENS.heroBg2} 100%)`,
            boxShadow: SHADOW_HERO,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 14px 10px" }}>
            <div
              style={{
                fontFamily: INTER_FONT,
                fontSize: 15,
                lineHeight: "21px",
                fontWeight: 400,
                letterSpacing: "0.2px",
                color: TOKENS.textOnDarkMuted,
              }}
            >
              {heroTitle}
            </div>

            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              <div
                style={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: 62,
                  lineHeight: "60px",
                  color: heroToneStyles.number,
                  fontWeight: 500,
                  letterSpacing: "-0.3px",
                }}
              >
                {heroNumber}
              </div>
              <div
                style={{
                  fontFamily: INTER_FONT,
                  fontSize: 13,
                  lineHeight: "18px",
                  color: heroToneStyles.subtitle,
                }}
              >
                {t("home.hero.totalItems", { defaultValue: "totale item attivi" })}
              </div>
            </div>

            <div
              style={{
                marginTop: 6,
                fontFamily: INTER_FONT,
                fontSize: 17,
                lineHeight: "24px",
                color: heroToneStyles.subtitle,
              }}
            >
              {heroSubtitle}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 7 }}>
              <span style={{ height: 6, borderRadius: 999, background: heroToneStyles.accentA, width: 56 }} />
              <span style={{ height: 6, borderRadius: 999, background: heroToneStyles.accentB, width: 56 }} />
              <span style={{ height: 6, borderRadius: 999, background: heroToneStyles.accentC, width: 56 }} />
            </div>
          </div>

          <div
            style={{
              borderTop: `1px solid ${heroToneStyles.line}`,
              padding: "10px 10px",
              textAlign: "center",
              fontFamily: DISPLAY_FONT,
              fontWeight: 500,
              fontSize: 18,
              lineHeight: "24px",
              color: heroToneStyles.next,
            }}
          >
            {heroNextLine}
          </div>
        </div>
      </div>

      <div style={{
        marginTop: -6,
        padding: "18px 16px 112px",
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        background: "rgba(230,219,207,0.92)",
      }}>
        {overdueCount > 0 && (
          <section style={{ marginBottom: 16 }}>
            <SectionTitle label={t("home.overdueRecent", { defaultValue: "Scadute (ultimi 7 giorni)" })} />
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 18,
                background: "rgba(246, 233, 231, 0.52)",
                boxShadow: SHADOW_CARD,
                padding: 10,
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
                    onOpenItem={openInHome}
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
          <section style={{ marginBottom: 16 }}>
            <SectionTitle label={t("home.todaySection", { defaultValue: "In scadenza oggi" })} />
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 18,
                background: TOKENS.bgInner,
                boxShadow: SHADOW_CARD,
                padding: 10,
              }}
            >
              <div style={{ border: `1px solid ${TOKENS.borderSoft}`, borderRadius: 12, background: TOKENS.bgInner, padding: "0 10px" }}>
                {todaySlice.map((item, idx) => (
                  <div key={item.id} style={{ borderTop: idx === 0 ? "none" : `1px solid ${TOKENS.borderSoft}` }}>
                    <FutureRow
                      item={item}
                      locale={locale}
                      formatNumber={formatNumber}
                      withAction
                      onComplete={onComplete}
                      onOpenItem={openInHome}
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
          <section style={{ marginBottom: 16 }}>
            <SectionTitle label={t("home.next7Section", { defaultValue: "Nei prossimi 7 giorni" })} />
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 18,
                background: TOKENS.bgInner,
                boxShadow: SHADOW_CARD,
                padding: 10,
              }}
            >
              <div style={{ border: `1px solid ${TOKENS.borderSoft}`, borderRadius: 12, background: TOKENS.bgInner, padding: "0 10px" }}>
                {next7Slice.map((item, idx) => (
                  <div key={item.id} style={{ borderTop: idx === 0 ? "none" : `1px solid ${TOKENS.borderSoft}` }}>
                    <FutureRow
                      item={item}
                      locale={locale}
                      formatNumber={formatNumber}
                      withAction
                      onComplete={onComplete}
                      onOpenItem={openInHome}
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
                borderRadius: 18,
                background: TOKENS.bgInner,
                boxShadow: SHADOW_CARD,
                padding: 10,
              }}
            >
              <div
                style={{
                  border: `1px solid ${TOKENS.borderSoft}`,
                  borderRadius: 12,
                  background: TOKENS.bgInner,
                  overflow: "hidden",
                  padding: "0 10px",
                }}
              >
                {data.incoming.map((item, idx) => (
                  <div key={item.id} style={{ borderTop: idx === 0 ? "none" : `1px solid ${TOKENS.borderSoft}` }}>
                    <FutureRow
                      item={item}
                      locale={locale}
                      formatNumber={formatNumber}
                      compact
                      onOpenItem={openInHome}
                      t={t}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
      {activeItem && (
        <div
          onClick={() => setActiveItem(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,22,18,0.45)",
            zIndex: 240,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "16px",
            backdropFilter: "blur(3px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              borderRadius: 18,
              border: `1px solid ${TOKENS.border}`,
              background: TOKENS.bgCard,
              boxShadow: SHADOW_CARD,
              padding: 14,
            }}
          >
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 22, lineHeight: "28px", color: TOKENS.textPrimary, fontWeight: 500 }}>
              {activeItem.title}
            </div>
            <div style={{ marginTop: 4, fontFamily: INTER_FONT, fontSize: 14, color: TOKENS.textSecondary }}>
              {startOfDay(activeItem.date).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
              {activeItem.asset ? ` · ${activeItem.asset}` : ""}
            </div>
            <div style={{ marginTop: 8, fontFamily: INTER_FONT, fontSize: 22, fontWeight: 600, color: TOKENS.textPrimary }}>
              <Amount item={activeItem} formatNumber={formatNumber} t={t} />
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ActionButton
                label={t("home.markDone", { defaultValue: "Segna fatto" })}
                primary
                overdueTone={activeItem.dayDiff < 0}
                onClick={() => { onComplete(activeItem.id); setActiveItem(null); }}
              />
              <ActionButton
                label={t("actions.postpone", { defaultValue: "Posticipa" })}
                onClick={() => { onPostpone(activeItem.id); setActiveItem(null); }}
              />
            </div>
            <button
              onClick={() => setActiveItem(null)}
              style={{
                marginTop: 10,
                width: "100%",
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 12,
                background: "rgba(255,255,255,0.45)",
                color: TOKENS.textSecondary,
                fontFamily: INTER_FONT,
                fontSize: 14,
                fontWeight: 500,
                padding: "8px 10px",
                cursor: "pointer",
              }}
            >
              {t("actions.close", { defaultValue: "Chiudi" })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
