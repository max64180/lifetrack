import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch } from 'firebase/firestore/lite';
import { DEFAULT_CATS, RANGES } from "./data/constants";
import { getCat } from "./utils/cats";
import { compressImage } from "./utils/files";
import i18n from "./i18n";

// 🔥 Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDjtRsWiCnK0Y9mOPVia8VXovPJG_Jxc04",
  authDomain: "lifetrack-6f77d.firebaseapp.com",
  projectId: "lifetrack-6f77d",
  storageBucket: "lifetrack-6f77d.firebasestorage.app",
  messagingSenderId: "978713532459",
  appId: "1:978713532459:web:6bb257db2ee79760a9b26e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Use Firestore Lite (REST) to avoid WebChannel issues in Safari
const db = getFirestore(app);




/* ── CONFIG & DATI ─────────────────────────────────────── */
// Format currency without decimals (fix #1)
const formatCurrency = (amount) => `€${Math.round(amount)}`;
const formatNumber = (amount) => Math.round(amount).toLocaleString(getLocale());

const TODAY = new Date(); TODAY.setHours(0,0,0,0);
function addDays(n) { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; }

/* ── DATI FAKE RIMOSSI - App vuota per uso reale ──────────────────────────────────── */


/* ── TIME RANGES ───────────────────────────────────────── */

/* ── GROUPING LOGIC ────────────────────────────────────── */
function getGroupKey(date, range) {
  const y = date.getFullYear(), m = date.getMonth();
  switch(range) {
    case "settimana": {
      const diff = Math.floor((date - TODAY) / 86400000);
      const w = Math.floor(diff / 7);
      const label = w === 0
        ? i18n.t("group.weekThis", "Questa settimana")
        : w === 1
          ? i18n.t("group.weekNext", "Prossima settimana")
          : i18n.t("group.weekPlus", { count: w, defaultValue: `Settimana +${w}` });
      return { key: `w${w}`, label, order: w };
    }
    case "mese":
      return { key: `${y}-${m}`, label: `${capitalize(date.toLocaleDateString(getLocale(), { month:"long" }))} ${y}`, order: y * 12 + m };
    case "trimestre": {
      const q = Math.floor(m / 3);
      return { key: `${y}-Q${q}`, label: i18n.t("group.quarter", { num: q + 1, year: y, defaultValue: `Q${q+1} ${y}` }), order: y * 4 + q };
    }
    case "semestre": {
      const s = m < 6 ? 0 : 1;
      const label = s === 0
        ? i18n.t("group.semesterFirst", { year: y, defaultValue: `1° semestre ${y}` })
        : i18n.t("group.semesterSecond", { year: y, defaultValue: `2° semestre ${y}` });
      return { key: `${y}-S${s}`, label, order: y * 2 + s };
    }
    case "anno":
      return { key: `${y}`, label: `${y}`, order: y };
    default:
      return { key: "all", label: i18n.t("group.all", "Tutte"), order: 0 };
  }
}

function groupItems(items, range) {
  const map = {};
  items.forEach(item => {
    const g = getGroupKey(item.date, range);
    if (!map[g.key]) map[g.key] = { ...g, items: [] };
    map[g.key].items.push(item);
  });
  return Object.values(map).sort((a, b) => a.order - b.order);
}

/* ── HELPERS ───────────────────────────────────────────── */
const getLocale = () => (i18n.language || "it").toLowerCase().startsWith("it") ? "it-IT" : "en-US";
const capitalize = (value) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

function diffDays(d) { return Math.round((d - TODAY) / 86400000); }
function fmtDate(d) { return d.toLocaleDateString(getLocale(), { day:"2-digit", month:"short" }); }

function getOccurrenceDate(startDate, i, intervalVal, unit) {
  const d = new Date(startDate);
  if (unit === "giorni") {
    d.setDate(startDate.getDate() + (intervalVal * i));
  } else if (unit === "settimane") {
    d.setDate(startDate.getDate() + (intervalVal * 7 * i));
  } else if (unit === "mesi") {
    d.setMonth(startDate.getMonth() + (intervalVal * i));
  } else if (unit === "anni") {
    d.setFullYear(startDate.getFullYear() + (intervalVal * i));
  }
  return d;
}

function getAutoEndDate() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nextYear = now.getFullYear() + 1;
  return new Date(nextYear, 11, 31, 23, 59, 59, 999);
}

function computeOccurrences({ startDate, interval, unit, endMode, endDate, count, max = 500 }) {
  if (!startDate || Number.isNaN(startDate.getTime())) return [];
  const safeInterval = Math.max(1, parseInt(interval) || 1);
  const safeCount = Math.max(1, parseInt(count) || 1);
  const mode = endMode || "auto";
  let end = null;
  if (mode === "date") {
    if (endDate) {
      const d = new Date(endDate + "T00:00:00");
      if (!Number.isNaN(d.getTime())) end = d;
    }
  } else if (mode === "auto") {
    end = getAutoEndDate();
  }
  if (end && end < startDate) end = startDate;

  const dates = [];
  if (mode === "count") {
    const limit = Math.min(safeCount, max);
    for (let i = 0; i < limit; i++) {
      dates.push(getOccurrenceDate(startDate, i, safeInterval, unit));
    }
    return dates;
  }

  const limit = max;
  for (let i = 0; i < limit; i++) {
    const d = getOccurrenceDate(startDate, i, safeInterval, unit);
    if (end && d > end) break;
    dates.push(d);
  }
  if (dates.length === 0) {
    dates.push(getOccurrenceDate(startDate, 0, safeInterval, unit));
  }
  return dates;
}

function inferEndMode(recurring) {
  if (!recurring) return "auto";
  if (recurring.endMode) return recurring.endMode;
  if (recurring.endDate) return "date";
  if (recurring.total) return "count";
  return "auto";
}

function inferPreset(interval, unit) {
  if (interval === 1 && unit === "mesi") return "mensile";
  if (interval === 3 && unit === "mesi") return "trimestrale";
  if (interval === 1 && unit === "anni") return "annuale";
  return "custom";
}

function resolveRecurringSchedule(form, startDate) {
  const interval = Math.max(1, parseInt(form.recurringInterval) || 1);
  const unit = form.recurringUnit || "mesi";
  let endMode = form.recurringEndMode || "auto";
  const count = Math.max(1, parseInt(form.recurringCount) || 1);
  let endDate = endMode === "date" ? form.recurringEndDate : "";
  if (endMode === "date" && !endDate) {
    endMode = "auto";
    endDate = "";
  }
  const dates = computeOccurrences({ startDate, interval, unit, endMode, endDate, count, max: 800 });
  return { interval, unit, endMode, endDate, count, dates, total: dates.length };
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function normalizeDeadline(raw) {
  if (!raw) return null;
  const date = toDate(raw.date);
  if (!isValidDate(date)) return null;
  const rawId = raw.id ?? raw.docId;
  const parsedId = typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : rawId;
  return { ...raw, id: parsedId ?? rawId, date };
}

function normalizeWorkLogs(raw = {}) {
  const parsed = {};
  Object.keys(raw || {}).forEach(key => {
    parsed[key] = (raw[key] || [])
      .map(log => {
        const date = toDate(log.date);
        const nextDate = log.nextDate ? toDate(log.nextDate) : null;
        if (!isValidDate(date)) return null;
        return {
          ...log,
          date,
          nextDate: nextDate && isValidDate(nextDate) ? nextDate : null
        };
      })
      .filter(Boolean);
  });
  return parsed;
}

function getUrgency(date, done) {
  if (done) return { color:"#aaa", bg:"#f0efe8", label:i18n.t("urgency.done", "Fatto") };
  const days = diffDays(date);
  if (days < 0)  return { color:"#E53935", bg:"#FFEBEE", label:i18n.t("urgency.overdue", "Scaduta") };
  if (days === 0) return { color:"#E53935", bg:"#FFEBEE", label:i18n.t("urgency.today", "Oggi") };
  if (days <= 3)  return { color:"#F4511E", bg:"#FBE9E7", label:i18n.t("urgency.days", { count: days, defaultValue: `${days}g` }) };
  if (days <= 7)  return { color:"#FB8C00", bg:"#FFF3E0", label:i18n.t("urgency.days", { count: days, defaultValue: `${days}g` }) };
  return               { color:"#4CAF6E", bg:"#E8F5E9", label:i18n.t("urgency.days", { count: days, defaultValue: `${days}g` }) };
}

/* ── COMPONENTI ────────────────────────────────────────── */

function LanguageToggle({ tone = "dark", size = 28 }) {
  const { i18n } = useTranslation();
  const current = (i18n.language || "it").toLowerCase().startsWith("it") ? "it" : "en";
  const setLang = (lng) => {
    if (lng === current) return;
    i18n.changeLanguage(lng);
  };
  const inactiveBg = tone === "dark" ? "rgba(255,255,255,.08)" : "#f0ede7";
  const inactiveColor = tone === "dark" ? "rgba(255,255,255,.7)" : "#6b6961";
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
      {[
        { id:"it", label:"Italiano", flag:"🇮🇹" },
        { id:"en", label:"English", flag:"🇬🇧" },
      ].map(lang => {
        const active = current === lang.id;
        return (
          <button
            key={lang.id}
            onClick={() => setLang(lang.id)}
            title={lang.label}
            aria-label={lang.label}
            style={{
              width:size, height:size, borderRadius:"50%", border:"none", cursor:"pointer",
              background: active ? "#E8855D" : inactiveBg,
              color: active ? "#fff" : inactiveColor,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:15, lineHeight:1, boxShadow: active ? "0 4px 12px rgba(0,0,0,.2)" : "none"
            }}
          >
            {lang.flag}
          </button>
        );
      })}
    </div>
  );
}

/* Range Selector */
function RangeSelector({ active, onChange }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-active="true"]`);
    el?.scrollIntoView({ inline:"center", behavior:"smooth", block:"nearest" });
  }, [active]);

  return (
    <div ref={ref} style={{
      display:"flex", gap:8, overflowX:"auto", padding:"0 18px",
      scrollbarWidth:"none", WebkitOverflowScrolling:"touch", scrollSnapType:"x mandatory",
      touchAction:"pan-x", // only allow horizontal scroll, prevent vertical page scroll
    }}>
      <style>{`::-webkit-scrollbar{display:none}`}</style>
      {RANGES.map(r => {
        const isActive = r.id === active;
        return (
          <button key={r.id} data-active={isActive} onClick={() => onChange(r.id)} style={{
            flexShrink:0, scrollSnapAlign:"center",
            padding:"8px 18px", borderRadius:22, border:"none", cursor:"pointer",
            background: isActive ? "#2d2b26" : "rgba(255,255,255,.12)",
            color: isActive ? "#fff" : "rgba(255,255,255,.55)",
            fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif",
            transition:"background .2s, color .2s, transform .15s",
            transform: isActive ? "scale(1.04)" : "scale(1)",
            boxShadow: isActive ? "0 3px 12px rgba(0,0,0,.25)" : "none",
          }}>{t(r.labelKey, { defaultValue: r.label })}</button>
        );
      })}
    </div>
  );
}

/* Budget summary bar */
function BudgetBar({ deadlines, range, cats }) {
  const { t } = useTranslation();
  const maxDays = RANGES.find(r => r.id === range)?.days || 30;
  const inRange = deadlines.filter(d => !d.done && diffDays(d.date) >= 0 && diffDays(d.date) <= maxDays);
  const inRangeBudgeted = inRange.filter(d => !d.estimateMissing);
  const total   = inRangeBudgeted.reduce((s, d) => s + d.budget, 0);
  const count   = inRange.length;
  const missingCount = inRange.filter(d => d.estimateMissing).length;
  const urgent  = inRange.filter(d => diffDays(d.date) <= 7).length;

  const catTotals = cats.map(c => ({
    ...c,
    amount: inRangeBudgeted.filter(d => d.cat === c.id).reduce((s, d) => s + d.budget, 0),
  })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);

  return (
    <div style={{ padding:"12px 18px 0" }}>
      <div style={{ background:"rgba(255,255,255,.08)", borderRadius:16, padding:"14px 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,.4)", fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>{t("budgetBar.title")}</div>
            <div style={{ fontSize:28, fontWeight:800, color:"#fff", letterSpacing:"-1px", marginTop:1, fontFamily:"'Sora',sans-serif" }}>{formatCurrency(total)}</div>
            {missingCount > 0 && (
              <div style={{ marginTop:4, fontSize:10, color:"rgba(255,255,255,.45)" }}>{t("budgetBar.missing", { count: missingCount })}</div>
            )}
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,.35)", fontWeight:700, textTransform:"uppercase" }}>{t("budgetBar.deadlines")}</div>
              <div style={{ fontSize:16, fontWeight:800, color:"rgba(255,255,255,.7)" }}>{count}</div>
            </div>
            {urgent > 0 && (
              <div style={{ background:"rgba(232,133,93,.25)", borderRadius:8, padding:"4px 8px", display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:12 }}>⚡</span>
                <span style={{ fontSize:13, fontWeight:800, color:"#E8855D" }}>{urgent}</span>
              </div>
            )}
          </div>
        </div>

        {catTotals.length > 0 && (
          <>
            <div style={{ display:"flex", height:6, borderRadius:3, overflow:"hidden", gap:2, background:"rgba(255,255,255,.08)" }}>
              {catTotals.map(c => (
                <div key={c.id} style={{ flex: c.amount, background: c.color, borderRadius:3, transition:"flex .4s ease", minWidth: c.amount > 0 ? 6 : 0 }}/>
              ))}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:7, flexWrap:"wrap" }}>
              {catTotals.map(c => (
                <div key={c.id} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:c.color }}/>
                  <span style={{ fontSize:10, color:"rgba(255,255,255,.45)", fontWeight:600 }}>{c.icon} {formatCurrency(c.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Carta scadenza – ICONE PIÙ GRANDI E VISIVE */
function DeadlineCard({ item, expanded, onToggle, onComplete, onDelete, onPostpone, onEdit, onSkip, onUploadDoc, onDeleteDoc, onViewDoc, onAssetClick, cats }) {
  const { t } = useTranslation();
  const cat = getCat(cats, item.cat);
  const urg = getUrgency(item.date, item.done);
  const days = diffDays(item.date);
  const catLabel = t(cat.labelKey || "", { defaultValue: cat.label });
  const unitMap = {
    giorni: "day",
    settimane: "week",
    mesi: "month",
    anni: "year",
  };
  const recurringUnitKey = item.recurring?.unit ? unitMap[item.recurring.unit] : null;
  const intervalLabel = recurringUnitKey
    ? (item.recurring.interval === 1
        ? t(`units.${recurringUnitKey}.one`)
        : t(`units.${recurringUnitKey}.other`))
    : (item.recurring?.unit || "");
  const recurringSummary = item.recurring && item.recurring.enabled
    ? t("card.repeatPattern", {
        index: item.recurring.index,
        total: item.recurring.total,
        interval: item.recurring.interval,
        unit: intervalLabel
      })
    : t("card.never");

  return (
    <div style={{ marginBottom:8 }}>
      <div
        onClick={() => onToggle(item.id)}
        style={{
          display:"flex", alignItems:"center", gap:12, padding:"12px 14px",
          background:"#fff", borderRadius: expanded ? "14px 14px 0 0" : 14,
          border:`2px solid ${expanded ? cat.color : "#edecea"}`,
          borderBottom: expanded ? "none" : undefined,
          cursor:"pointer", transition:"border-color .2s", WebkitTapHighlightColor:"transparent", minHeight:64,
        }}
      >
        {/* ICONA GRANDE CON BACKGROUND COLORATO */}
        <div style={{
          width:48, height:48, borderRadius:12, flexShrink:0,
          background: item.done ? "#f0efe8" : cat.light,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:24, // emoji grande
          border: `2px solid ${item.done ? "#e0ddd6" : cat.color + "44"}`,
          transition:"all .2s",
        }}>
          {item.done ? "✓" : cat.icon}
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:700, color: item.done ? "#999" : "#2d2b26", textDecoration: item.done ? "line-through" : "none", fontFamily:"'Sora',sans-serif", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {item.title}
          </div>
          <div style={{ display:"flex", gap:5, marginTop:4, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:11, background:cat.light, color:cat.color, borderRadius:8, padding:"2px 8px", fontWeight:700, border:`1px solid ${cat.color}33` }}>
              {catLabel}
            </span>
            {item.asset && (
              <span 
                onClick={(e) => { e.stopPropagation(); onAssetClick(item.cat, item.asset); }}
                style={{ 
                  fontSize:10, background:"#f5f4f0", color:"#6b6961", borderRadius:8, 
                  padding:"2px 7px", fontWeight:600, border:"1px solid #e8e6e0",
                  cursor:"pointer", transition:"all .2s",
                }}
                onMouseOver={e => e.target.style.background = "#e8e6e0"}
                onMouseOut={e => e.target.style.background = "#f5f4f0"}
              >
                {item.asset}
              </span>
            )}
            {item.recurring && item.recurring.enabled && (
              <span style={{ fontSize:10, background:"#EBF2FC", color:"#5B8DD9", borderRadius:8, padding:"2px 7px", fontWeight:700, border:"1px solid #5B8DD966" }}>
                🔁 {item.recurring.index}/{item.recurring.total}
              </span>
            )}
            <span style={{ fontSize:11, color:"#b5b2a8", marginLeft:2 }}>{fmtDate(item.date)}</span>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
          {item.budget > 0 && <span style={{ fontSize:14, fontWeight:800, color:cat.color }}>{formatCurrency(item.budget)}</span>}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
            {item.mandatory && !item.done && (
              <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:"#E53935", borderRadius:8, padding:"3px 7px", display:"flex", alignItems:"center", gap:2 }}>
                ⚠ INDEROG.
              </span>
            )}
            {item.autoPay && !item.done && (
              <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:"#5B8DD9", borderRadius:8, padding:"3px 7px", display:"flex", alignItems:"center", gap:2 }}>
                🔄 AUTO
              </span>
            )}
            {item.estimateMissing && !item.done && (
              <span style={{ fontSize:10, fontWeight:800, color:"#8a6d1f", background:"#FFF8ED", borderRadius:8, padding:"3px 7px", display:"flex", alignItems:"center", gap:2 }}>
                ❔ STIMA
              </span>
            )}
            <span style={{ fontSize:10, fontWeight:700, color:urg.color, background:urg.bg, borderRadius:8, padding:"3px 8px" }}>{urg.label}</span>
          </div>
          <span style={{ fontSize:12, color:"#b5b2a8", transition:"transform .25s", transform: expanded ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
        </div>
      </div>

      {expanded && (
        <div style={{
          background:"#fff", borderRadius:"0 0 14px 14px",
          border:`2px solid ${cat.color}`, borderTop:"none",
          padding:"12px 14px 14px",
          animation:"expandDown .22s ease both",
        }}>
          <style>{`@keyframes expandDown{from{opacity:0;max-height:0;padding-top:0;padding-bottom:0}to{opacity:1;max-height:1000px;padding-top:12px;padding-bottom:14px}}`}</style>

          <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:80, background:"#faf9f7", borderRadius:10, padding:"8px 10px" }}>
              <div style={{ fontSize:9, color:"#8a877f", fontWeight:700, textTransform:"uppercase", letterSpacing:".4px" }}>{t("card.dueDate")}</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#2d2b26", marginTop:2 }}>{fmtDate(item.date)}</div>
            </div>
            <div style={{ flex:1, minWidth:80, background:"#faf9f7", borderRadius:10, padding:"8px 10px" }}>
              <div style={{ fontSize:9, color:"#8a877f", fontWeight:700, textTransform:"uppercase", letterSpacing:".4px" }}>{t("card.budget")}</div>
              <div style={{ fontSize:14, fontWeight:700, color: item.estimateMissing ? "#8a6d1f" : (item.budget > 0 ? "#4CAF6E" : "#aaa"), marginTop:2 }}>
                {item.estimateMissing ? t("card.estimateMissing") : (item.budget > 0 ? `€${item.budget}` : "—")}
              </div>
            </div>
            <div style={{ flex:1, minWidth:80, background:"#faf9f7", borderRadius:10, padding:"8px 10px" }}>
              <div style={{ fontSize:9, color:"#8a877f", fontWeight:700, textTransform:"uppercase", letterSpacing:".4px" }}>{t("card.repeats")}</div>
              <div style={{ fontSize:13, fontWeight:600, color:"#2d2b26", marginTop:2 }}>
                {recurringSummary}
              </div>
            </div>
          </div>

          {item.notes && (
            <div style={{ fontSize:12, color:"#6b6961", background:"#faf9f7", borderRadius:10, padding:"8px 10px", marginBottom:12, lineHeight:1.4 }}>
              💬 {item.notes}
            </div>
          )}
          
          {item.mandatory && (
            <div style={{ fontSize:11, color:"#E53935", background:"#FFF0EC", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              {t("card.mandatory")}
            </div>
          )}

          {item.autoPay && !item.done && (
            <div style={{ fontSize:11, color:"#5B8DD9", background:"#EBF2FC", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              {t("card.autoPayActive")}
            </div>
          )}

          {item.autoCompleted && item.done && (
            <div style={{ fontSize:11, color:"#4CAF6E", background:"#E8F5E9", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              {t("card.autoCompleted")}
            </div>
          )}

          {item.skipped && item.done && (
            <div style={{ fontSize:11, color:"#6b6961", background:"#f0efe8", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              {t("card.skipped")}
            </div>
          )}

          {item.estimateMissing && !item.done && (
            <div style={{ fontSize:11, color:"#8a6d1f", background:"#FFF8ED", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <span>{t("card.estimateMissingTitle")}</span>
              <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"#2d2b26", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                {t("card.addEstimate")}
              </button>
            </div>
          )}

          {/* Documents section */}
          {((item.documents && item.documents.length > 0) || !item.done) && (
            <div style={{ background:"#faf9f7", borderRadius:10, padding:"8px 10px", marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#8a877f", fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>{t("docs.title")}</div>
              
              {item.documents && item.documents.length > 0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:6 }}>
                  {item.documents.map(doc => (
                    <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", borderRadius:8, padding:"6px 8px", border:"1px solid #e8e6e0" }}>
                      <span style={{ fontSize:16 }}>{doc.type === 'receipt' ? '🧾' : '📄'}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{doc.filename}</div>
                        <div style={{ fontSize:9, color:"#8a877f" }}>{doc.type === 'receipt' ? t("docs.receipt") : t("docs.document")}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); onViewDoc(doc); }} style={{ padding:"3px 7px", borderRadius:6, border:"none", background:"#EBF2FC", color:"#5B8DD9", fontSize:10, fontWeight:600, cursor:"pointer" }}>{t("actions.view")}</button>
                      <button onClick={(e) => { e.stopPropagation(); if(window.confirm(t("docs.deleteConfirm"))) onDeleteDoc(item.id, doc.id); }} style={{ padding:"3px 6px", borderRadius:6, border:"none", background:"#FFF0EC", color:"#E53935", fontSize:11, fontWeight:600, cursor:"pointer", lineHeight:1 }}>✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize:10, color:"#b5b2a8", fontStyle:"italic", marginBottom:6 }}>{t("docs.none")}</div>
              )}
              
              {/* Upload buttons - più compatti */}
              {!item.done && (
                <label style={{ display:"block", padding:"7px", borderRadius:8, border:"1px dashed #e8e6e0", background:"#fff", color:"#6b6961", fontSize:11, fontWeight:600, cursor:"pointer", textAlign:"center", minHeight:32 }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={(e) => { if(e.target.files[0]) onUploadDoc(item.id, 'incoming', e.target.files[0]); e.target.value=''; }} />
                  {t("docs.attachDocument")}
                </label>
              )}
              {item.done && (
                <label style={{ display:"block", padding:"7px", borderRadius:8, border:"1px dashed #4CAF6E44", background:"#E8F5E9", color:"#4CAF6E", fontSize:11, fontWeight:600, cursor:"pointer", textAlign:"center", minHeight:32 }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={(e) => { if(e.target.files[0]) onUploadDoc(item.id, 'receipt', e.target.files[0]); e.target.value=''; }} />
                  {t("docs.attachReceipt")}
                </label>
              )}
            </div>
          )}

          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} style={{
              flex:1, padding:"11px", borderRadius:10, border:"2px solid #5B8DD9",
              background:"#EBF2FC", color:"#5B8DD9", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>✏️ {t("actions.edit")}</button>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            {/* Se è scaduta, offri "Posticipa" */}
            {days < 0 && !item.done && (
              <button onClick={(e) => { e.stopPropagation(); onPostpone(item.id); }} style={{
                flex:1, padding:"11px", borderRadius:10, border:"none",
                background:"#FB8C00", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
              }}>↻ {t("actions.postpone")}</button>
            )}

            {item.recurring && item.recurring.enabled && !item.done && (
              <button onClick={(e) => { e.stopPropagation(); onSkip(item.id); }} style={{
                flex:1, padding:"11px", borderRadius:10, border:"none",
                background:"#edecea", color:"#6b6961", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
              }}>⏭ {t("actions.skip")}</button>
            )}
            
            <button onClick={(e) => { e.stopPropagation(); onComplete(item.id); }} style={{
              flex: days < 0 && !item.done ? 1 : 2, padding:"11px", borderRadius:10, border:"none",
              background: item.done ? "#edecea" : cat.color,
              color: item.done ? "#6b6961" : "#fff",
              fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>{item.done ? `↩ ${t("actions.reactivate")}` : `✓ ${t("actions.complete")}`}</button>
            
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} style={{
              flex:1, padding:"11px", borderRadius:10, border:"none",
              background:"#FFF0EC", color:"#E53935", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>{t("actions.delete")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Smart Category Filter with asset sub-filters */
function CategoryFilter({ cats, deadlines, filterCat, filterAsset, expandedCat, onSelectCat, onSelectAsset, onToggleExpand, activeTab, maxDays, filterMandatory, setFilterMandatory, filterRecurring, setFilterRecurring, filterAutoPay, setFilterAutoPay, filterEssential, setFilterEssential, filterEstimateMissing, setFilterEstimateMissing }) {
  const { t } = useTranslation();
  // Count deadlines per category (only active timeline deadlines)
  const catCounts = useMemo(() => {
    const counts = {};
    deadlines.forEach(d => {
      const days = diffDays(d.date);
      const isInScope = activeTab === "done" ? d.done : (days >= 0 && days <= maxDays && !d.done);
      if (isInScope) {
        counts[d.cat] = (counts[d.cat] || 0) + 1;
      }
    });
    return counts;
  }, [deadlines, activeTab, maxDays]);

  // Sort categories by deadline count (descending)
  const sortedCats = useMemo(() => {
    return [...cats].sort((a, b) => (catCounts[b.id] || 0) - (catCounts[a.id] || 0));
  }, [cats, catCounts]);

  const handleCatClick = (catId) => {
    const cat = getCat(cats, catId);
    const hasAssets = cat.assets && cat.assets.length > 0;
    
    if (filterCat === catId) {
      // Already filtered by this cat - clear filter
      onSelectCat(null);
      onSelectAsset(null);
      onToggleExpand(null);
    } else {
      // New category selected
      onSelectCat(catId);
      onSelectAsset(null);
      // Auto-expand if has assets
      if (hasAssets) {
        onToggleExpand(catId);
      } else {
        onToggleExpand(null);
      }
    }
  };

  return (
    <div style={{ background:"#f5f4f0", paddingBottom:8 }}>
      <div style={{ display:"flex", gap:7, overflowX:"auto", padding:"10px 18px 4px", scrollbarWidth:"none" }}>
        <button onClick={() => { onSelectCat(null); onSelectAsset(null); onToggleExpand(null); }} style={{
          flexShrink:0, borderRadius:18, padding:"6px 14px", border:"none", cursor:"pointer", fontSize:12, fontWeight:700,
          background: filterCat === null ? "#2d2b26" : "#edecea",
          color: filterCat === null ? "#fff" : "#6b6961", minHeight:36,
        }}>{t("filters.all")}</button>
        
        {sortedCats.map(c => {
          const count = catCounts[c.id] || 0;
          if (count === 0) return null; // Hide categories with no deadlines
          
          return (
            <button key={c.id} onClick={() => handleCatClick(c.id)} style={{
              flexShrink:0, borderRadius:18, padding:"6px 14px", cursor:"pointer", fontSize:12, fontWeight:700,
              background: filterCat === c.id ? c.light : "#edecea",
              color: filterCat === c.id ? c.color : "#6b6961",
              border: `1.5px solid ${filterCat === c.id ? c.color + "55" : "transparent"}`, minHeight:36,
              position:"relative",
            }}>
              {c.icon} {t(c.labelKey || "", { defaultValue: c.label })}
              <span style={{ 
                marginLeft:4, fontSize:10, opacity:.6, fontWeight:800,
                background: filterCat === c.id ? c.color + "22" : "rgba(0,0,0,.08)",
                borderRadius:8, padding:"1px 5px",
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Asset sub-filters - appear when category with assets is selected */}
      {filterCat && expandedCat === filterCat && (() => {
        const cat = getCat(cats, filterCat);
        if (!cat.assets || cat.assets.length === 0) return null;
        
        return (
          <div style={{ 
            padding:"0 18px 6px", 
            animation:"slideDown .2s ease both",
          }}>
            <style>{`@keyframes slideDown{from{opacity:0;max-height:0}to{opacity:1;max-height:100px}}`}</style>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", paddingLeft:8 }}>
              <button onClick={() => onSelectAsset(null)} style={{
                borderRadius:14, padding:"4px 11px", border:"none", cursor:"pointer", fontSize:11, fontWeight:600,
                background: filterAsset === null ? cat.color : "rgba(255,255,255,.7)",
                color: filterAsset === null ? "#fff" : "#6b6961",
                minHeight:32,
              }}>{t("filters.all")}</button>
              
              {cat.assets.map(asset => {
                // Count deadlines per asset
                const assetCount = deadlines.filter(d => {
                  const days = diffDays(d.date);
                  const isInScope = activeTab === "done" ? d.done : (days >= 0 && days <= maxDays && !d.done);
                  return isInScope && d.cat === filterCat && d.asset === asset;
                }).length;
                
                return (
                  <button key={asset} onClick={() => onSelectAsset(asset)} style={{
                    borderRadius:14, padding:"4px 11px", cursor:"pointer", fontSize:11, fontWeight:600,
                    background: filterAsset === asset ? cat.color : "rgba(255,255,255,.7)",
                    color: filterAsset === asset ? "#fff" : "#6b6961",
                    border: `1px solid ${filterAsset === asset ? cat.color : "#e8e6e0"}`,
                    minHeight:32,
                  }}>
                    {asset}
                    <span style={{ marginLeft:4, fontSize:9, opacity:.7 }}>({assetCount})</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Advanced filters row */}
      <div style={{ display:"flex", gap:6, overflowX:"auto", padding:"0 18px 6px", scrollbarWidth:"none", marginTop:4 }}>
        <button onClick={() => setFilterMandatory(!filterMandatory)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterMandatory ? "#FFF0EC" : "#edecea",
          color: filterMandatory ? "#E53935" : "#8a877f",
          border: `1.5px solid ${filterMandatory ? "#E5393555" : "transparent"}`,
          minHeight:32,
        }}>{t("filters.mandatory")}</button>

        <button onClick={() => setFilterRecurring(!filterRecurring)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterRecurring ? "#EBF2FC" : "#edecea",
          color: filterRecurring ? "#5B8DD9" : "#8a877f",
          border: `1.5px solid ${filterRecurring ? "#5B8DD955" : "transparent"}`,
          minHeight:32,
        }}>{t("filters.recurring")}</button>

        <button onClick={() => setFilterAutoPay(!filterAutoPay)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterAutoPay ? "#EBF2FC" : "#edecea",
          color: filterAutoPay ? "#5B8DD9" : "#8a877f",
          border: `1.5px solid ${filterAutoPay ? "#5B8DD955" : "transparent"}`,
          minHeight:32,
        }}>{t("filters.autoPay")}</button>

        <button onClick={() => setFilterEssential(!filterEssential)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterEssential ? "#EDFBF2" : "#edecea",
          color: filterEssential ? "#4CAF6E" : "#8a877f",
          border: `1.5px solid ${filterEssential ? "#4CAF6E55" : "transparent"}`,
          minHeight:32,
        }}>{t("filters.essential")}</button>

        <button onClick={() => setFilterEstimateMissing(!filterEstimateMissing)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterEstimateMissing ? "#FFF8ED" : "#edecea",
          color: filterEstimateMissing ? "#8a6d1f" : "#8a877f",
          border: `1.5px solid ${filterEstimateMissing ? "#E6C97A55" : "transparent"}`,
          minHeight:32,
        }}>{t("filters.estimate")}</button>
      </div>
    </div>
  );
}

/* Group header */
function GroupHeader({ group, cats }) {
  const total = group.items.filter(d => !d.done && !d.estimateMissing).reduce((s, d) => s + d.budget, 0);
  const activeCount = group.items.filter(d => !d.done).length;
  const doneCount = group.items.filter(d => d.done).length;

  const catMap = {};
  group.items.filter(d => !d.done && !d.estimateMissing).forEach(d => { catMap[d.cat] = (catMap[d.cat] || 0) + d.budget; });
  const catEntries = Object.entries(catMap).sort((a,b) => b[1] - a[1]);

  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"18px 0 8px" }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{group.label}</div>
        <div style={{ fontSize:11, color:"#8a877f", marginTop:1 }}>
          {activeCount} attiv{activeCount !== 1 ? "e" : "a"}{doneCount > 0 ? ` · ${doneCount} completat${doneCount !== 1 ? "e" : "a"}` : ""}
        </div>
      </div>
      <div style={{ textAlign:"right" }}>
        {total > 0 && <div style={{ fontSize:16, fontWeight:800, color:"#4CAF6E" }}>{formatCurrency(total)}</div>}
        {catEntries.length > 0 && (
          <div style={{ display:"flex", gap:2, marginTop:4, justifyContent:"flex-end" }}>
            {catEntries.map(([catId, amt]) => {
              const c = getCat(cats, catId);
              const w = Math.max(Math.round((amt / total) * 48), 6);
              return <div key={catId} style={{ width:w, height:4, borderRadius:2, background:c.color }}/>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ADD SHEET CON ASSET PICKER ────────────────────────── */
/* ── PAYMENT FLOW MODAL ────────────────────────────────── */
function PaymentFlowModal({ open, item, onConfirm, onClose, step, amount, setAmount, downpaymentDate, setDownpaymentDate, onChangeStep }) {
  const { t } = useTranslation();
  if (!open || !item) return null;

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:200,
      display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:"24px 24px 0 0", padding:"0 20px 34px", width:"100%", maxWidth:480,
        animation:"sheetUp .28s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"75vh", overflowY:"auto",
      }}>
        <style>{`@keyframes sheetUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
        <div style={{ width:44, height:5, background:"#e0ddd6", borderRadius:3, margin:"12px auto 16px" }}/>
        
        {step === 'choose' && (
          <>
            <h3 style={{ margin:"0 0 8px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{item.title}</h3>
            <div style={{ fontSize:13, color:"#8a877f", marginBottom:20 }}>{t("payment.expected")} <strong>€{item.budget}</strong></div>

            {/* Big button: Pagata per intero */}
            <button onClick={() => onConfirm('full')} style={{
              width:"100%", padding:"16px", borderRadius:14, border:"none",
              background:"#4CAF6E", color:"#fff", cursor:"pointer", fontSize:16, fontWeight:700,
              marginBottom:12, boxShadow:"0 4px 14px rgba(76,175,110,.25)", minHeight:56,
            }}>✓ {t("payment.paidFull", { amount: item.budget })}</button>

            {/* Secondary options */}
            <button onClick={() => onChangeStep('downpayment')} style={{
              width:"100%", padding:"14px", borderRadius:12, border:"2px solid #e8e6e0",
              background:"#fff", color:"#2d2b26", cursor:"pointer", fontSize:14, fontWeight:600,
              marginBottom:8, minHeight:48,
            }}>💰 {t("payment.downpayment")}</button>

            <button onClick={() => onChangeStep('partial')} style={{
              width:"100%", padding:"14px", borderRadius:12, border:"2px solid #e8e6e0",
              background:"#fff", color:"#2d2b26", cursor:"pointer", fontSize:14, fontWeight:600,
              marginBottom:8, minHeight:48,
            }}>✏ {t("payment.differentAmount")}</button>

            <button onClick={() => onConfirm('not_paid')} style={{
              width:"100%", padding:"14px", borderRadius:12, border:"2px solid #FBE9E7",
              background:"#FFF0EC", color:"#E53935", cursor:"pointer", fontSize:14, fontWeight:600,
              minHeight:48,
            }}>✗ {t("payment.notPaid")}</button>
          </>
        )}

        {step === 'partial' && (
          <>
            <h3 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{t("payment.paidAmountTitle")}</h3>
            <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6, textTransform:"uppercase" }}>{t("payment.paidAmountLabel")}</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={String(item.budget)}
              autoFocus
              style={{ width:"100%", padding:"14px 16px", borderRadius:12, border:"2px solid #edecea", fontSize:18, fontWeight:700, outline:"none", marginBottom:20, textAlign:"center" }}
            />
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:"14px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>{t("actions.cancel")}</button>
              <button onClick={() => onConfirm('partial')} style={{ flex:2, padding:"14px", borderRadius:12, border:"none", background:"#4CAF6E", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 }}>{t("payment.confirm")}</button>
            </div>
          </>
        )}

        {step === 'downpayment' && (
          <>
            <h3 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{t("payment.downpaymentTitle")}</h3>
            
            <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6, textTransform:"uppercase" }}>{t("payment.downpaymentLabel")}</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={String(Math.round(item.budget / 2))}
              autoFocus
              style={{ width:"100%", padding:"14px 16px", borderRadius:12, border:"2px solid #edecea", fontSize:18, fontWeight:700, outline:"none", marginBottom:16, textAlign:"center" }}
            />

            {amount && Number(amount) < item.budget && (
              <div style={{ background:"#EBF2FC", border:"1px solid #5B8DD966", borderRadius:10, padding:"10px 12px", marginBottom:16 }}>
                <div style={{ fontSize:12, color:"#5B8DD9", fontWeight:600 }}>{t("payment.remaining", { amount: item.budget - Number(amount) })}</div>
              </div>
            )}

            <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6, textTransform:"uppercase" }}>{t("payment.balanceDue")}</label>
            <input
              type="date"
              value={downpaymentDate}
              onChange={e => setDownpaymentDate(e.target.value)}
              style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #edecea", fontSize:14, outline:"none", marginBottom:20 }}
            />

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:"14px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>{t("actions.cancel")}</button>
              <button 
                onClick={() => onConfirm('downpayment')} 
                disabled={!amount || !downpaymentDate || Number(amount) >= item.budget}
                style={{ 
                  flex:2, padding:"14px", borderRadius:12, border:"none", 
                  background: (!amount || !downpaymentDate || Number(amount) >= item.budget) ? "#e0ddd6" : "#FB8C00", 
                  color:"#fff", cursor: (!amount || !downpaymentDate || Number(amount) >= item.budget) ? "not-allowed" : "pointer", 
                  fontSize:14, fontWeight:700,
                  opacity: (!amount || !downpaymentDate || Number(amount) >= item.budget) ? 0.5 : 1
                }}
              >{t("payment.createBalance")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddSheet({ open, onClose, onSave, onUpdate, cats, presetAsset, editingItem }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0); // 0 doc, 1 base, 2 options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState({ 
    title:"", cat:"casa", asset:null, date:"", budget:"", notes:"", 
    mandatory:false, essential:true, autoPay:false, documents:[],
    recurringEnabled: false,
    recurringInterval: 1,
    recurringUnit: "mesi",
    recurringCount: 12,
    recurringPreset: "mensile", // mensile | trimestrale | annuale | custom
    recurringEndMode: "auto", // auto | count | date
    recurringEndDate: ""
  });
  useEffect(() => { 
    if (!open) {
      setStep(0);
      setShowAdvanced(false);
      setForm({ 
        title:"", cat:"casa", asset:null, date:"", budget:"", notes:"", 
        mandatory:false, essential:true, autoPay:false, documents:[],
        recurringEnabled: false,
        recurringInterval: 1,
        recurringUnit: "mesi",
        recurringCount: 12,
        recurringPreset: "mensile",
        recurringEndMode: "auto",
        recurringEndDate: ""
      });
    } else if (editingItem) {
      setStep(1);
      const interval = editingItem.recurring?.interval || 1;
      const unit = editingItem.recurring?.unit || "mesi";
      const preset = inferPreset(interval, unit);
      const endMode = inferEndMode(editingItem.recurring);
      const dateStr = editingItem.date instanceof Date 
        ? editingItem.date.toISOString().split('T')[0]
        : new Date(editingItem.date).toISOString().split('T')[0];
      setShowAdvanced(
        preset === "custom" || endMode !== "auto"
      );
      setForm({
        title: editingItem.title,
        cat: editingItem.cat,
        asset: editingItem.asset,
        date: dateStr,
        budget: editingItem.estimateMissing ? "" : String(editingItem.budget),
        notes: editingItem.notes || "",
        mandatory: editingItem.mandatory || false,
        essential: editingItem.essential !== undefined ? editingItem.essential : true,
        autoPay: editingItem.autoPay || false,
        documents: editingItem.documents || [],
        recurringEnabled: editingItem.recurring?.enabled || false,
        recurringInterval: interval,
        recurringUnit: unit,
        recurringCount: editingItem.recurring?.total || 12,
        recurringPreset: preset,
        recurringEndMode: endMode,
        recurringEndDate: editingItem.recurring?.endDate || ""
      });
    } else if (presetAsset) {
      setStep(1);
      setShowAdvanced(false);
      setForm(prev => ({
        ...prev,
        cat: presetAsset.catId,
        asset: presetAsset.assetName
      }));
    }
  }, [open, presetAsset, editingItem]);
  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const selectedCat = getCat(cats, form.cat);
  const hasAssets = selectedCat.assets && selectedCat.assets.length > 0;
  const steps = [
    t("wizard.step.document"),
    t("wizard.step.details"),
    t("wizard.step.recurring"),
    t("wizard.step.options")
  ];
  const lastStep = steps.length - 1;
  const interval = Math.max(1, parseInt(form.recurringInterval) || 1);
  const count = Math.max(1, parseInt(form.recurringCount) || 1);
  const budgetMissing = form.budget === "";
  const baseAmount = budgetMissing ? 0 : (Number(form.budget) || 0);
  const baseDate = form.date ? new Date(form.date + "T00:00:00") : null;
  const today = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const schedule = form.recurringEnabled && baseDate && !Number.isNaN(baseDate.getTime())
    ? resolveRecurringSchedule(form, baseDate)
    : null;
  const occurrences = schedule ? schedule.dates : [];
  const totalOccurrences = schedule ? schedule.total : 0;
  const autoEndLabel = getAutoEndDate().toLocaleDateString(getLocale(), { day:'2-digit', month:'short', year:'numeric' });
  const lang = (i18n.language || "it").toLowerCase().startsWith("it") ? "it" : "en";
  const unitMap = {
    giorni: { it:["giorno","giorni"], en:["day","days"] },
    settimane: { it:["settimana","settimane"], en:["week","weeks"] },
    mesi: { it:["mese","mesi"], en:["month","months"] },
    anni: { it:["anno","anni"], en:["year","years"] },
  };
  const unitLabels = unitMap[form.recurringUnit] || { it:[form.recurringUnit, form.recurringUnit], en:[form.recurringUnit, form.recurringUnit] };
  const unitLabel = interval === 1 ? unitLabels[lang][0] : unitLabels[lang][1];
  const frequencyLabel = form.recurringPreset === "mensile"
    ? t("recurring.everySingle", { unit: lang === "it" ? "mese" : "month" })
    : form.recurringPreset === "trimestrale"
      ? t("recurring.everyMultiple", { count: 3, unit: lang === "it" ? "mesi" : "months" })
      : form.recurringPreset === "annuale"
        ? t("recurring.everySingle", { unit: lang === "it" ? "anno" : "year" })
        : (interval === 1
          ? t("recurring.everySingle", { unit: unitLabel })
          : t("recurring.everyMultiple", { count: interval, unit: unitLabel }));
  const endDateLabel = form.recurringEndDate
    ? new Date(form.recurringEndDate + "T00:00:00").toLocaleDateString(getLocale(), { day:'2-digit', month:'short', year:'numeric' })
    : "";
  const endSummary = form.recurringEndMode === "auto"
    ? t("recurring.summary.auto", { date: autoEndLabel })
    : form.recurringEndMode === "date"
      ? (endDateLabel ? t("recurring.summary.date", { date: endDateLabel }) : t("recurring.summary.datePlaceholder"))
      : t("recurring.summary.count", { count });
  const presetOptions = [
    { id:"mensile", label: t("recurring.preset.monthly"), interval:1, unit:"mesi" },
    { id:"trimestrale", label: t("recurring.preset.quarterly"), interval:3, unit:"mesi" },
    { id:"annuale", label: t("recurring.preset.yearly"), interval:1, unit:"anni" },
    { id:"custom", label: t("recurring.preset.custom") },
  ];

  const preview = (() => {
    if (!form.recurringEnabled || occurrences.length === 0) return null;
    const currentYear = today.getFullYear();
    const thisYearEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999);
    const thisYearOccurrences = occurrences.filter(d => d >= today && d <= thisYearEnd);
    const thisYearTotal = thisYearOccurrences.length * baseAmount;
    const next = occurrences.find(d => d >= today) || occurrences[0] || null;

    const nextYear = currentYear + 1;
    const nextYearStart = new Date(nextYear, 0, 1);
    const nextYearEnd = new Date(nextYear, 11, 31, 23, 59, 59, 999);
    const nextYearOccurrences = occurrences.filter(d => d >= nextYearStart && d <= nextYearEnd);
    const nextYearTotal = nextYearOccurrences.length * baseAmount;

    return {
      thisYearCount: thisYearOccurrences.length,
      thisYearTotal,
      next,
      nextYear,
      nextYearCount: nextYearOccurrences.length,
      nextYearTotal
    };
  })();
  const canProceedDetails = form.title.trim() && form.date;

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:200,
      display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:"24px 24px 0 0", padding:"0 20px 34px", width:"100%", maxWidth:480,
        animation:"sheetUp .28s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"85vh", overflowY:"auto",
      }}>
        <style>{`@keyframes sheetUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
        <div style={{ width:44, height:5, background:"#e0ddd6", borderRadius:3, margin:"12px auto 16px" }}/>
        <h3 style={{ margin:"0 0 6px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>
          {editingItem ? t("wizard.editTitle") : t("wizard.newTitle")}
        </h3>
        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          {steps.map((s, i) => (
            <div key={s} style={{
              flex:1, height:4, borderRadius:4,
              background: i <= step ? "#E8855D" : "#f0ede7"
            }}/>
          ))}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:12, color:"#8a877f", fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>
            Step {step + 1} · {steps[step]}
          </div>
          <div style={{ fontSize:11, color:"#b5b2a8" }}>
            {form.title ? form.title : t("wizard.untitled")}
            {form.date ? ` · ${form.date}` : ""}
            {form.budget ? ` · €${form.budget}` : ""}
          </div>
        </div>

        {step === 0 && (
          <>
            <label style={lbl}>{t("wizard.docLabel")}</label>
            <div style={{ background:"#faf9f7", borderRadius:12, padding:"10px 12px", border:"1px solid #edecea" }}>
              {form.documents.length === 0 ? (
                <label style={{ display:"block", padding:"10px", borderRadius:10, border:"1px dashed #e8e6e0", background:"#fff", color:"#8a877f", fontSize:12, fontWeight:600, cursor:"pointer", textAlign:"center", minHeight:44 }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={async (e) => {
                    if(e.target.files[0]) {
                      try {
                        const base64 = await compressImage(e.target.files[0]);
                        const doc = { id: Date.now(), type: 'incoming', base64, filename: e.target.files[0].name, uploadDate: new Date().toISOString() };
                        set("documents", [doc]);
                      } catch(err) { alert(t("errors.fileUpload")); }
                      e.target.value = '';
                    }
                  }} />
                  {t("wizard.docUpload")}
                </label>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:8, background:"#fff", borderRadius:8, padding:"6px 10px", border:"1px solid #e8e6e0" }}>
                  <span style={{ fontSize:16 }}>📄</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{form.documents[0].filename}</div>
                    <div style={{ fontSize:10, color:"#8a877f" }}>{t("wizard.docAttached")}</div>
                  </div>
                  <button type="button" onClick={() => set("documents", [])} style={{ padding:"4px 8px", borderRadius:6, border:"none", background:"#FFF0EC", color:"#E53935", fontSize:11, fontWeight:600, cursor:"pointer" }}>{t("wizard.docRemove")}</button>
                </div>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <label style={lbl}>{t("wizard.title")}</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} placeholder={t("wizard.titlePlaceholder")} style={inp} autoFocus/>

            <label style={lbl}>{t("wizard.category")}</label>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
              {cats.map(c => (
                <button key={c.id} onClick={() => { set("cat", c.id); set("asset", null); }} style={{
                  background: form.cat === c.id ? c.light : "#f5f4f0",
                  border: `2px solid ${form.cat === c.id ? c.color : "transparent"}`,
                  borderRadius:12, padding:"8px 12px", cursor:"pointer", fontSize:13,
                  fontWeight: form.cat === c.id ? 700 : 500,
                  color: form.cat === c.id ? c.color : "#6b6961",
                  minHeight:44,
                }}>{c.icon} {t(c.labelKey || "", { defaultValue: c.label })}</button>
              ))}
            </div>

            {hasAssets && (
              <>
                <label style={lbl}>{t("wizard.asset")}</label>
                <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                  {selectedCat.assets.map(a => (
                    <button key={a} onClick={() => set("asset", a)} style={{
                      background: form.asset === a ? selectedCat.light : "#f5f4f0",
                      border: `2px solid ${form.asset === a ? selectedCat.color : "#e8e6e0"}`,
                      borderRadius:12, padding:"8px 12px", cursor:"pointer", fontSize:13,
                      fontWeight: form.asset === a ? 700 : 500,
                      color: form.asset === a ? selectedCat.color : "#6b6961",
                      minHeight:44,
                    }}>{a}</button>
                  ))}
                </div>
              </>
            )}

            <label style={lbl}>{t("wizard.dueDate")}</label>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={inp}/>

            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1 }}>
                <label style={lbl}>{t("wizard.budget")}</label>
                <input type="number" value={form.budget} onChange={e => set("budget", e.target.value)} placeholder="0" style={inp}/>
                <div style={{ fontSize:11, color:"#8a877f", marginTop:6 }}>
                  {t("wizard.budgetHint")}
                </div>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ marginTop:2, background:"#faf9f7", border:"1px solid #edecea", borderRadius:10, padding:"10px 12px" }}>
              <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", marginBottom:form.recurringEnabled ? 12 : 0 }}>
                <input
                  type="checkbox"
                  checked={form.recurringEnabled}
                  onChange={e => set("recurringEnabled", e.target.checked)}
                  style={{ width:20, height:20, cursor:"pointer", accentColor:"#5B8DD9" }}
                />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>{t("recurring.title")}</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>{t("recurring.subtitle")}</div>
                </div>
              </label>

              {form.recurringEnabled && (
                <div style={{ paddingLeft:4 }}>
                  <div style={{ fontSize:11, color:"#8a877f", fontWeight:700, marginBottom:6 }}>{t("recurring.frequency")}</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
                    {presetOptions.map(p => {
                      const active = form.recurringPreset === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            set("recurringPreset", p.id);
                            if (p.interval) {
                              set("recurringInterval", p.interval);
                              set("recurringUnit", p.unit);
                            }
                            if (p.id === "custom") setShowAdvanced(true);
                          }}
                          style={{
                            padding:"7px 12px", borderRadius:999, border: active ? "2px solid #2d2b26" : "2px solid transparent",
                            background: active ? "#2d2b26" : "#fff", color: active ? "#fff" : "#6b6961",
                            fontSize:12, fontWeight:700, cursor:"pointer",
                            boxShadow: active ? "0 4px 10px rgba(0,0,0,.15)" : "none",
                          }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ background:"#fff", border:"1px solid #edecea", borderRadius:10, padding:"8px 10px", fontSize:11, color:"#6b6961" }}>
                    <div style={{ fontWeight:700, color:"#2d2b26" }}>{t("recurring.summary.repeat", { label: frequencyLabel })}</div>
                    <div style={{ marginTop:4, color:"#8a877f" }}>{endSummary}</div>
                  </div>

                  <button
                    onClick={() => setShowAdvanced(v => !v)}
                    style={{ marginTop:10, background:"transparent", border:"none", color:"#5B8DD9", fontSize:12, fontWeight:700, cursor:"pointer" }}
                  >
                    {showAdvanced ? t("recurring.advancedHide") : t("recurring.advanced")}
                  </button>

                  {showAdvanced && (
                    <div style={{ marginTop:8, background:"#fff", border:"1px solid #edecea", borderRadius:10, padding:"10px" }}>
                      {form.recurringPreset === "custom" && (
                        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
                          <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, minWidth:70 }}>{t("recurring.every")}</label>
                          <input 
                            type="number" 
                            value={form.recurringInterval} 
                            onChange={e => set("recurringInterval", e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value) || 1))}
                            onBlur={e => { if(e.target.value === "") set("recurringInterval", 1); }}
                            min="1"
                            style={{ width:70, padding:"6px 8px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:13, textAlign:"center" }}
                          />
                          <select 
                            value={form.recurringUnit} 
                            onChange={e => set("recurringUnit", e.target.value)}
                            style={{ flex:1, padding:"6px 10px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:13, background:"#fff" }}
                          >
                            <option value="giorni">giorni</option>
                            <option value="settimane">settimane</option>
                            <option value="mesi">mesi</option>
                            <option value="anni">anni</option>
                          </select>
                        </div>
                      )}

                      <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, display:"block", marginBottom:6 }}>{t("recurring.endTitle")}</label>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                        {[
                          { id:"auto", label:t("recurring.endAuto") },
                          { id:"count", label:t("recurring.endCount") },
                          { id:"date", label:t("recurring.endDate") },
                        ].map(opt => {
                          const active = form.recurringEndMode === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => set("recurringEndMode", opt.id)}
                              style={{
                                padding:"6px 10px", borderRadius:999, border: active ? "2px solid #5B8DD9" : "2px solid transparent",
                                background: active ? "#EBF2FC" : "#f5f4f0", color: active ? "#2d2b26" : "#6b6961",
                                fontSize:11, fontWeight:700, cursor:"pointer",
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>

                      {form.recurringEndMode === "count" && (
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, minWidth:70 }}>{t("recurring.endCount")}</label>
                          <input 
                            type="number" 
                            value={form.recurringCount} 
                            onChange={e => set("recurringCount", e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value) || 1))}
                            onBlur={e => { if(e.target.value === "") set("recurringCount", 1); }}
                            min="1"
                            max="999"
                            style={{ width:80, padding:"6px 8px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:13, textAlign:"center" }}
                          />
                        </div>
                      )}

                      {form.recurringEndMode === "date" && (
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, minWidth:70 }}>{t("recurring.endDate")}</label>
                          <input 
                            type="date" 
                            value={form.recurringEndDate}
                            onChange={e => set("recurringEndDate", e.target.value)}
                            style={{ flex:1, padding:"6px 8px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:13 }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ marginTop:10, padding:"8px", background:"#EBF2FC", borderRadius:8, fontSize:11, color:"#5B8DD9", fontWeight:600 }}>
                    {budgetMissing
                      ? t("recurring.occurrencesNoAmount", { count: totalOccurrences || count })
                      : t("recurring.occurrences", { count: totalOccurrences || count, amount: form.budget })
                    }
                  </div>
                </div>
              )}
            </div>

            {preview && (
              <div style={{ marginTop:12, background:"#2d2b26", color:"#fff", borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:10, opacity:.6, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>
                  {t("impact.title")}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginTop:6, gap:12 }}>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800 }}>{budgetMissing ? "—" : formatCurrency(preview.thisYearTotal)}</div>
                    <div style={{ fontSize:10, opacity:.6 }}>{t("impact.thisYear")} · {preview.thisYearCount} {t("common.deadlines")}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:18, fontWeight:800 }}>{budgetMissing ? "—" : formatCurrency(preview.nextYearTotal)}</div>
                    <div style={{ fontSize:10, opacity:.6 }}>{t("impact.nextYear", { year: preview.nextYear })} · {preview.nextYearCount} {t("common.deadlines")}</div>
                    {preview.next && (
                      <div style={{ fontSize:10, opacity:.6 }}>
                        {t("impact.next", { date: preview.next.toLocaleDateString(lang === "it" ? "it-IT" : "en-US", { day:'2-digit', month:'short' }) })}
                      </div>
                    )}
                  </div>
                </div>
                {budgetMissing && (
                  <div style={{ marginTop:6, fontSize:10, opacity:.6 }}>
                    {t("impact.missing")}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ marginTop:2, background:"#fff8f5", border:"1px solid #FBE9E7", borderRadius:10, padding:"10px 12px" }}>
              <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                <input
                  type="checkbox"
                  checked={form.mandatory}
                  onChange={e => { 
                    const val = e.target.checked;
                    set("mandatory", val);
                    if (val) set("essential", true);
                  }}
                  style={{ width:20, height:20, cursor:"pointer", accentColor:"#E53935" }}
                />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#E53935" }}>{t("options.mandatoryTitle")}</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>{t("options.mandatoryHint")}</div>
                </div>
              </label>
            </div>

            <div style={{ marginTop:10, background:"#f0f8ff", border:"1px solid #C8E6FF", borderRadius:10, padding:"10px 12px" }}>
              <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                <input
                  type="checkbox"
                  checked={form.essential}
                  onChange={e => set("essential", e.target.checked)}
                  disabled={form.mandatory}
                  style={{ width:20, height:20, cursor: form.mandatory ? "not-allowed" : "pointer", accentColor:"#4CAF6E", opacity: form.mandatory ? 0.5 : 1 }}
                />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#4CAF6E" }}>{t("options.essentialTitle")}</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>{t("options.essentialHint")}</div>
                </div>
              </label>
            </div>

            <div style={{ marginTop:14, background:"#EBF2FC", border:"1px solid #5B8DD966", borderRadius:10, padding:"10px 12px" }}>
              <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                <input
                  type="checkbox"
                  checked={form.autoPay}
                  onChange={e => set("autoPay", e.target.checked)}
                  style={{ width:20, height:20, cursor:"pointer", accentColor:"#5B8DD9" }}
                />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#5B8DD9" }}>{t("options.autoPayTitle")}</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>{t("options.autoPayHint")}</div>
                </div>
              </label>
            </div>

            <label style={lbl}>{t("wizard.notes")}</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder={t("wizard.notesPlaceholder")} rows={2} style={{ ...inp, resize:"vertical" }}/>
          </>
        )}

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:"14px", borderRadius:14, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961", minHeight:48 }}>{t("actions.cancel")}</button>
          {step > 0 && (
            <button onClick={() => setStep(s => Math.max(0, s - 1))} style={{ flex:1, padding:"14px", borderRadius:14, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, color:"#2d2b26", minHeight:48 }}>
              {t("actions.back")}
            </button>
          )}
          {step < lastStep ? (
            <>
              {step === 0 && (
                <button onClick={() => setStep(s => Math.min(lastStep, s + 1))} style={{
                  flex:1, padding:"14px", borderRadius:14, border:"2px solid #e8e6e0", background:"#fff", color:"#6b6961", cursor:"pointer", fontSize:14, fontWeight:600, minHeight:48
                }}>{t("actions.skip")}</button>
              )}
              <button
                onClick={() => {
                  if (step === 1 && !canProceedDetails) return;
                  setStep(s => Math.min(lastStep, s + 1));
                }}
                disabled={step === 1 && !canProceedDetails}
                style={{
                  flex:2, padding:"14px", borderRadius:14, border:"none",
                  background: (step === 1 && !canProceedDetails) ? "#e0ddd6" : "#2d2b26",
                  color:"#fff",
                  cursor: (step === 1 && !canProceedDetails) ? "not-allowed" : "pointer",
                  fontSize:14, fontWeight:700, minHeight:48,
                  boxShadow:"0 4px 14px rgba(0,0,0,.2)",
                  opacity: (step === 1 && !canProceedDetails) ? 0.6 : 1,
                }}
              >
                {t("actions.next")}
              </button>
            </>
          ) : (
            <button onClick={() => {
              if (form.title && form.date) {
                if (editingItem) {
                  if (onUpdate) onUpdate(form);
                  onClose();
                  return;
                }
                if (form.recurringEnabled) {
                  const series = [];
                  const seriesId = `series_${Date.now()}`;
                  const startDate = baseDate || new Date(form.date+"T00:00:00");
                  const schedule = resolveRecurringSchedule(form, startDate);
                  schedule.dates.forEach((occurrenceDate, i) => {
                    series.push({
                      id: Date.now() + i,
                      title: form.title,
                      cat: form.cat,
                      asset: form.asset,
                      date: occurrenceDate,
                      budget: baseAmount,
                      estimateMissing: budgetMissing,
                      notes: form.notes,
                      mandatory: form.mandatory,
                      essential: form.essential,
                      autoPay: form.autoPay,
                      documents: i === 0 ? form.documents : [],
                      done: false,
                      recurring: {
                        enabled: true,
                        interval: schedule.interval,
                        unit: schedule.unit,
                        seriesId: seriesId,
                        index: i + 1,
                        total: schedule.total,
                        baseAmount: baseAmount,
                        endMode: schedule.endMode,
                        endDate: schedule.endDate,
                        preset: form.recurringPreset,
                      }
                    });
                  });
                  onSave(series);
                } else {
                  onSave([{ 
                    id: Date.now(), 
                    title: form.title,
                    cat: form.cat,
                    asset: form.asset,
                    date: new Date(form.date+"T00:00:00"), 
                    budget: Number(form.budget)||0,
                    estimateMissing: budgetMissing,
                    notes: form.notes,
                    mandatory: form.mandatory,
                    essential: form.essential,
                    autoPay: form.autoPay,
                    documents: form.documents,
                    done: false,
                    recurring: null
                  }]);
                }
                onClose();
              }
            }}
            disabled={!canProceedDetails}
            style={{
              flex:2, padding:"14px", borderRadius:14, border:"none",
              background: !canProceedDetails ? "#e0ddd6" : "#2d2b26",
              color:"#fff",
              cursor: !canProceedDetails ? "not-allowed" : "pointer",
              fontSize:14, fontWeight:700, minHeight:48,
              boxShadow:"0 4px 14px rgba(0,0,0,.2)",
              opacity: !canProceedDetails ? 0.6 : 1,
            }}>{t("actions.add")}</button>
          )}
        </div>
      </div>
    </div>
  );
}

const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#8a877f", marginTop:14, marginBottom:5, letterSpacing:".5px", textTransform:"uppercase" };
const inp = { width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #edecea", fontSize:14, fontFamily:"'Sora',sans-serif", color:"#2d2b26", background:"#faf9f7", outline:"none", boxSizing:"border-box", minHeight:44 };

/* ── CATEGORY MANAGEMENT SHEET ─────────────────────────── */
/* ── STATISTICHE SHEET ──────────────────────────────────── */
/* ── STATISTICHE SHEET (NUOVA VERSIONE AGGREGATA) ──────────────────────────────────── */
function StatsSheet({ open, onClose, deadlines, cats }) {
  const { t } = useTranslation();
  const [view, setView] = useState("anno"); // anno, futuro
  
  if (!open) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;

  // ════════════ ANNO CORRENTE ════════════
  const yearStart = new Date(currentYear, 0, 1);
  const yearEnd = new Date(currentYear, 11, 31);
  
  const currentYearDeadlines = deadlines.filter(d => 
    d.done && !d.skipped && !d.estimateMissing && d.date >= yearStart && d.date <= yearEnd
  );
  
  const currentYearTotal = currentYearDeadlines.reduce((sum, d) => sum + d.budget, 0);
  const currentYearCount = currentYearDeadlines.length;

  // ════════════ ANNO PRECEDENTE ════════════
  const prevYearStart = new Date(previousYear, 0, 1);
  const prevYearEnd = new Date(previousYear, 11, 31);
  
  const prevYearDeadlines = deadlines.filter(d => 
    d.done && !d.skipped && !d.estimateMissing && d.date >= prevYearStart && d.date <= prevYearEnd
  );
  
  const prevYearTotal = prevYearDeadlines.reduce((sum, d) => sum + d.budget, 0);
  
  // Variazione percentuale
  const yearChange = prevYearTotal > 0 
    ? ((currentYearTotal - prevYearTotal) / prevYearTotal * 100).toFixed(0)
    : null;

  // ════════════ BREAKDOWN PER CATEGORIA (ANNO CORRENTE) ════════════
  const categoryBreakdown = cats.map(cat => {
    const catDeadlines = currentYearDeadlines.filter(d => d.cat === cat.id);
    const catTotal = catDeadlines.reduce((sum, d) => sum + d.budget, 0);
    const percentage = currentYearTotal > 0 ? (catTotal / currentYearTotal * 100).toFixed(0) : 0;
    return { cat, total: catTotal, count: catDeadlines.length, percentage };
  }).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // ════════════ TREND MENSILE (ANNO CORRENTE) ════════════
  const monthlyTrend = [];
  for (let m = 0; m < 12; m++) {
    const monthStart = new Date(currentYear, m, 1);
    const monthEnd = new Date(currentYear, m + 1, 0);
    const monthDeadlines = currentYearDeadlines.filter(d => d.date >= monthStart && d.date <= monthEnd);
    const monthTotal = monthDeadlines.reduce((sum, d) => sum + d.budget, 0);
    monthlyTrend.push({
      month: monthStart.toLocaleDateString(getLocale(), { month: 'short' }),
      total: monthTotal
    });
  }
  
  const maxMonth = Math.max(...monthlyTrend.map(m => m.total));
  const peakMonth = monthlyTrend.find(m => m.total === maxMonth);

  // ════════════ FUTURO (PROSSIMI 12 MESI) ════════════
  const futureEnd = new Date(now);
  futureEnd.setMonth(futureEnd.getMonth() + 12);
  
  const futureDeadlines = deadlines.filter(d => 
    !d.done && d.date >= now && d.date <= futureEnd
  );
  const futureBudgeted = futureDeadlines.filter(d => !d.estimateMissing);
  
  const futureTotal = futureBudgeted.reduce((sum, d) => sum + d.budget, 0);
  const futureCount = futureDeadlines.length;
  const futureRecurring = futureDeadlines.filter(d => d.recurring && d.recurring.enabled).length;
  const futureAutoPay = futureDeadlines.filter(d => d.autoPay).length;

  // Breakdown futuro per categoria
  const futureCategoryBreakdown = cats.map(cat => {
    const catDeadlines = futureBudgeted.filter(d => d.cat === cat.id);
    const catTotal = catDeadlines.reduce((sum, d) => sum + d.budget, 0);
    const percentage = futureTotal > 0 ? (catTotal / futureTotal * 100).toFixed(0) : 0;
    return { cat, total: catTotal, count: catDeadlines.length, percentage };
  }).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // Timeline prossimi 6 mesi
  const futureMonthlyTrend = [];
  for (let m = 0; m < 6; m++) {
    const monthStart = new Date(now);
    monthStart.setMonth(now.getMonth() + m, 1);
    monthStart.setHours(0, 0, 0, 0);
    
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);
    
    const monthDeadlines = futureBudgeted.filter(d => d.date >= monthStart && d.date <= monthEnd);
    const monthTotal = monthDeadlines.reduce((sum, d) => sum + d.budget, 0);
    
    futureMonthlyTrend.push({
      month: monthStart.toLocaleDateString(getLocale(), { month: 'short', year: 'numeric' }),
      total: monthTotal,
      count: monthDeadlines.length
    });
  }
  
  const maxFutureMonth = Math.max(...futureMonthlyTrend.map(m => m.total));
  const futurePeakMonth = futureMonthlyTrend.find(m => m.total === maxFutureMonth);

  // Prossimi 30 giorni
  const next30Days = new Date(now);
  next30Days.setDate(next30Days.getDate() + 30);
  const next30DaysCount = futureDeadlines.filter(d => d.date <= next30Days).length;

  // ════════════ INSIGHTS ════════════
  const avgMonthly = currentYearTotal / 12;
  const topCat = categoryBreakdown[0];

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:200,
      display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:"24px 24px 0 0", padding:"0 20px 34px", width:"100%", maxWidth:480,
        animation:"sheetUp .28s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"85vh", overflowY:"auto",
      }}>
        <div style={{ width:44, height:5, background:"#e0ddd6", borderRadius:3, margin:"12px auto 16px" }}/>
        
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>{t("stats.title")}</h2>
          <button onClick={onClose} style={{ fontSize:24, background:"none", border:"none", cursor:"pointer", color:"#8a877f", padding:0 }}>×</button>
        </div>

        {/* Tabs Anno/Futuro */}
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          {[
            { id:"anno", label: t("stats.tabs.year", { year: currentYear }) },
            { id:"futuro", label: t("stats.tabs.future") }
          ].map(option => (
            <button key={option.id} onClick={() => setView(option.id)} style={{
              flex:1, padding:"10px", borderRadius:10, border:"none", cursor:"pointer", fontSize:12, fontWeight:700,
              background: view === option.id ? "#2d2b26" : "#f5f4f0",
              color: view === option.id ? "#fff" : "#6b6961",
            }}>{option.label}</button>
          ))}
        </div>

        {/* ═══════════ TAB: ANNO CORRENTE ═══════════ */}
        {view === "anno" && (
          <div>
            {/* Card principale */}
            <div style={{ background:"linear-gradient(135deg, #667eea 0%, #764ba2 100%)", borderRadius:16, padding:"20px", marginBottom:20, color:"#fff" }}>
              <div style={{ fontSize:11, fontWeight:700, opacity:0.8, marginBottom:4 }}>
                {t("stats.year.cardTitle", { year: currentYear })}
              </div>
              <div style={{ fontSize:36, fontWeight:800, fontFamily:"'Sora',sans-serif", marginBottom:8 }}>€{formatNumber(currentYearTotal)}</div>
              {yearChange !== null && (
                <div style={{ fontSize:13, opacity:0.9 }}>
                  {t("stats.year.change", { direction: yearChange >= 0 ? "↑" : "↓", percent: Math.abs(yearChange), prevYear: previousYear, prevTotal: formatNumber(prevYearTotal) })}
                </div>
              )}
              <div style={{ fontSize:12, marginTop:8, opacity:0.8 }}>{t("stats.year.completed", { count: currentYearCount })}</div>
            </div>

            {/* Insights */}
            <div style={{ background:"#FFF8ED", borderRadius:12, padding:"14px 16px", marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#F0B84D", marginBottom:8 }}>{t("stats.insights.title")}</div>
              <div style={{ fontSize:12, color:"#2d2b26", lineHeight:1.6, display:"flex", flexDirection:"column", gap:4 }}>
                <div>{t("stats.insights.avgMonthly", { amount: formatNumber(avgMonthly) })}</div>
                {topCat && (
                  <div>
                    {t("stats.insights.topCategory", {
                      icon: topCat.cat.icon,
                      label: t(topCat.cat.labelKey || "", { defaultValue: topCat.cat.label }),
                      percentage: topCat.percentage
                    })}
                  </div>
                )}
                {peakMonth && (
                  <div>{t("stats.insights.peakMonth", { month: peakMonth.month, amount: formatNumber(peakMonth.total) })}</div>
                )}
              </div>
            </div>

            {/* Breakdown categorie */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>{t("stats.breakdownTitle")}</div>
              {categoryBreakdown.map(({ cat, total, count, percentage }) => (
                <div key={cat.id} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:18 }}>{cat.icon}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:"#2d2b26" }}>{t(cat.labelKey || "", { defaultValue: cat.label })}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:"#8a877f" }}>{count}</span>
                      <span style={{ fontSize:15, fontWeight:800, color:cat.color }}>€{formatNumber(total)}</span>
                    </div>
                  </div>
                  <div style={{ background:"#f5f4f0", borderRadius:8, height:8, overflow:"hidden" }}>
                    <div style={{ background:cat.color, height:"100%", width:`${percentage}%`, transition:"width .3s" }}/>
                  </div>
                  <div style={{ fontSize:10, color:"#8a877f", marginTop:2 }}>{percentage}%</div>
                </div>
              ))}
            </div>

            {/* Trend mensile */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>{t("stats.trendTitle")}</div>
              {monthlyTrend.filter(m => m.total > 0).map(({ month, total }) => (
                <div key={month} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <div style={{ width:35, fontSize:11, color:"#6b6961", fontWeight:600 }}>{month}</div>
                  <div style={{ flex:1, background:"#f5f4f0", borderRadius:6, height:24, overflow:"hidden", position:"relative" }}>
                    <div style={{ 
                      background:"linear-gradient(90deg, #5B8DD9, #7B8BE8)", 
                      height:"100%", 
                      width:`${(total / maxMonth * 100)}%`,
                      transition:"width .3s",
                      display:"flex",
                      alignItems:"center",
                      paddingLeft:8
                    }}>
                      <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>€{formatNumber(total)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════ TAB: FUTURO ═══════════ */}
        {view === "futuro" && (
          <div>
            {/* Card principale */}
            <div style={{ background:"linear-gradient(135deg, #667eea 0%, #764ba2 100%)", borderRadius:16, padding:"20px", marginBottom:20, color:"#fff" }}>
              <div style={{ fontSize:11, fontWeight:700, opacity:0.8, marginBottom:4 }}>{t("stats.future.cardTitle")}</div>
              <div style={{ fontSize:36, fontWeight:800, fontFamily:"'Sora',sans-serif", marginBottom:8 }}>€{formatNumber(futureTotal)}</div>
              <div style={{ fontSize:12, marginTop:8, opacity:0.9 }}>
                {t("stats.future.summary", { count: futureCount, recurring: futureRecurring, autoPay: futureAutoPay })}
              </div>
            </div>

            {/* Insights */}
            <div style={{ background:"#EBF2FC", borderRadius:12, padding:"14px 16px", marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#5B8DD9", marginBottom:8 }}>{t("stats.insights.title")}</div>
              <div style={{ fontSize:12, color:"#2d2b26", lineHeight:1.6, display:"flex", flexDirection:"column", gap:4 }}>
                {futurePeakMonth && (
                  <div>{t("stats.insights.futurePeak", { month: futurePeakMonth.month, amount: formatNumber(futurePeakMonth.total) })}</div>
                )}
                <div>{t("stats.insights.next30", { count: next30DaysCount })}</div>
                <div>{t("stats.insights.futureAvg", { amount: formatNumber(futureTotal / 12) })}</div>
              </div>
            </div>

            {/* Breakdown categorie */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>{t("stats.breakdownTitle")}</div>
              {futureCategoryBreakdown.map(({ cat, total, count, percentage }) => (
                <div key={cat.id} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:18 }}>{cat.icon}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:"#2d2b26" }}>{t(cat.labelKey || "", { defaultValue: cat.label })}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:"#8a877f" }}>{count}</span>
                      <span style={{ fontSize:15, fontWeight:800, color:cat.color }}>€{formatNumber(total)}</span>
                    </div>
                  </div>
                  <div style={{ background:"#f5f4f0", borderRadius:8, height:8, overflow:"hidden" }}>
                    <div style={{ background:cat.color, height:"100%", width:`${percentage}%`, transition:"width .3s" }}/>
                  </div>
                  <div style={{ fontSize:10, color:"#8a877f", marginTop:2 }}>{percentage}%</div>
                </div>
              ))}
            </div>

            {/* Timeline prossimi mesi */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>{t("stats.futureTimelineTitle")}</div>
              {futureMonthlyTrend.filter(m => m.total > 0).map(({ month, total, count }) => (
                <div key={month} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <div style={{ width:70, fontSize:10, color:"#6b6961", fontWeight:600 }}>{month}</div>
                  <div style={{ flex:1, background:"#f5f4f0", borderRadius:6, height:24, overflow:"hidden", position:"relative" }}>
                    <div style={{ 
                      background:"linear-gradient(90deg, #5B8DD9, #7B8BE8)", 
                      height:"100%", 
                      width:`${(total / maxFutureMonth * 100)}%`,
                      transition:"width .3s",
                      display:"flex",
                      alignItems:"center",
                      paddingLeft:8
                    }}>
                      <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>€{formatNumber(total)}</span>
                    </div>
                  </div>
                  <div style={{ fontSize:10, color:"#8a877f", width:25 }}>{t("stats.futureTimelineCount", { count })}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function AssetListSheet({ open, onClose, deadlines, cats, onSelectAsset }) {
  const { t } = useTranslation();
  if (!open) return null;

  // Raggruppa asset per categoria
  const assetsByCategory = cats
    .map(cat => {
      if (!cat.assets || cat.assets.length === 0) return null;
      
      return {
        cat,
        assets: cat.assets.map(assetName => {
          const assetDeadlines = deadlines.filter(d => d.cat === cat.id && d.asset === assetName);
          const completed = assetDeadlines.filter(d => d.done);
          const totalSpent = completed.filter(d => !d.estimateMissing).reduce((sum, d) => sum + d.budget, 0);
          
          return {
            name: assetName,
            deadlines: assetDeadlines.length,
            completed: completed.length,
            totalSpent
          };
        })
      };
    })
    .filter(Boolean);

  const hasAssets = assetsByCategory.length > 0;

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:210,
      display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:"24px 24px 0 0", padding:"0 20px 34px", width:"100%", maxWidth:480,
        animation:"sheetUp .28s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"85vh", overflowY:"auto",
      }}>
        <div style={{ width:44, height:5, background:"#e0ddd6", borderRadius:3, margin:"12px auto 16px" }}/>
        
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>{t("assetList.title")}</h2>
          <button onClick={onClose} style={{ fontSize:24, background:"none", border:"none", cursor:"pointer", color:"#8a877f", padding:0 }}>×</button>
        </div>

        {!hasAssets ? (
          <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🏷️</div>
            <div style={{ fontSize:16, fontWeight:600, color:"#8a877f", marginBottom:8 }}>{t("assetList.emptyTitle")}</div>
            <div style={{ fontSize:13, color:"#b5b2a8", lineHeight:1.6 }}>
              {t("assetList.emptyHint")}
            </div>
          </div>
        ) : (
          assetsByCategory.map(({ cat, assets }) => (
            <div key={cat.id} style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:16 }}>{cat.icon}</span>
                {t(cat.labelKey || "", { defaultValue: cat.label })}
              </div>
              
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {assets.map(asset => (
                  <button
                    key={asset.name}
                    onClick={() => { onSelectAsset(cat.id, asset.name); onClose(); }}
                    style={{
                      display:"flex", alignItems:"center", gap:12, background:"#faf9f7", 
                      borderRadius:12, padding:"12px 14px", cursor:"pointer", border:"1px solid #e8e6e0",
                      transition:"all .2s", textAlign:"left",
                    }}
                    onMouseOver={e => e.currentTarget.style.background = "#f0ede7"}
                    onMouseOut={e => e.currentTarget.style.background = "#faf9f7"}
                  >
                    <div style={{ 
                      width:44, height:44, borderRadius:10, 
                      background:cat.light, border:`2px solid ${cat.color}33`,
                      display:"flex", alignItems:"center", justifyContent:"center", fontSize:20
                    }}>
                      {cat.icon}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:"#2d2b26", marginBottom:2 }}>{asset.name}</div>
                      <div style={{ fontSize:11, color:"#8a877f" }}>
                        {t("assetList.itemStats", { deadlines: asset.deadlines, completed: asset.completed })}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:16, fontWeight:800, color:cat.color }}>€{formatNumber(asset.totalSpent)}</div>
                      <div style={{ fontSize:10, color:"#8a877f" }}>{t("assetList.total")}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── ASSET SHEET ──────────────────────────────────── */
function AssetSheet({ open, onClose, deadlines, cats, catId, assetName, workLogs, onAddWorkLog, onViewDoc }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("panoramica");
  const [showAddWork, setShowAddWork] = useState(false);
  const [editingWorkLog, setEditingWorkLog] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  if (!open) return null;

  const cat = cats.find(c => c.id === catId);
  if (!cat) return null;
  const catLabel = t(cat.labelKey || "", { defaultValue: cat.label });

  const assetKey = `${catId}_${assetName.toLowerCase().replace(/\s+/g, '_')}`;
  const assetWorkLogs = (workLogs[assetKey] || []).sort((a, b) => b.date - a.date);

  const assetDeadlines = deadlines
    .filter(d => d.cat === catId && d.asset === assetName)
    .sort((a, b) => b.date - a.date);

  const completed = assetDeadlines.filter(d => d.done);
  const upcoming = assetDeadlines.filter(d => !d.done);
  const totalSpent = completed.filter(d => !d.estimateMissing).reduce((sum, d) => sum + d.budget, 0);
  
  const allDocuments = assetDeadlines
    .flatMap(d => d.documents || [])
    .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

  const isAuto = catId === "auto";

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:220,
      display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:"24px 24px 0 0", padding:"0 20px 34px", width:"100%", maxWidth:480,
        animation:"sheetUp .28s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"85vh", overflowY:"auto",
      }}>
        <div style={{ width:44, height:5, background:"#e0ddd6", borderRadius:3, margin:"12px auto 16px" }}/>
        
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
          <div>
            <div style={{ fontSize:28, marginBottom:4 }}>{cat.icon}</div>
            <h2 style={{ margin:0, fontSize:20, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>{assetName}</h2>
            <div style={{ fontSize:12, color:"#8a877f", marginTop:2 }}>{catLabel}</div>
          </div>
          <button onClick={onClose} style={{ fontSize:24, background:"none", border:"none", cursor:"pointer", color:"#8a877f", padding:0 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:6, marginBottom:20, borderBottom:"2px solid #f5f4f0" }}>
          {[
            { id:"panoramica", label: t("asset.tabs.overview") },
            { id:"scadenze", label: t("asset.tabs.deadlines") },
            { id:"registro", label: t("asset.tabs.log") }
          ].map(tabOption => (
            <button key={tabOption.id} onClick={() => setTab(tabOption.id)} style={{
              flex:1, padding:"10px 8px", background:"none", border:"none", cursor:"pointer",
              fontSize:12, fontWeight:700, color: tab === tabOption.id ? "#2d2b26" : "#8a877f",
              borderBottom: tab === tabOption.id ? "2px solid #2d2b26" : "2px solid transparent",
              marginBottom:"-2px", transition:"all .2s"
            }}>{tabOption.label}</button>
          ))}
        </div>

        {/* TAB: PANORAMICA */}
        {tab === "panoramica" && (
          <div>
            {/* Stats card */}
            <div style={{ background:"#f5f4f0", borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
              <div style={{ fontSize:11, color:"#8a877f", fontWeight:700, marginBottom:4 }}>{t("asset.totalSpent")}</div>
              <div style={{ fontSize:28, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>€{formatNumber(totalSpent)}</div>
              <div style={{ fontSize:12, color:"#6b6961", marginTop:4 }}>
                {t("asset.summary", { deadlines: completed.length, worklogs: assetWorkLogs.length })}
              </div>
            </div>

            {/* Prossime scadenze */}
            {upcoming.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>{t("asset.nextDeadlines")}</div>
                {upcoming.sort((a, b) => a.date - b.date).slice(0, 3).map(d => (
                  <div key={d.id} style={{ background:"#EBF2FC", borderRadius:8, padding:"8px 10px", marginBottom:6, border:"1px solid #5B8DD966" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:"#2d2b26" }}>{d.title}</div>
                        <div style={{ fontSize:10, color:"#8a877f", marginTop:2 }}>{d.date.toLocaleDateString(getLocale())}</div>
                      </div>
                      <div style={{ fontSize:14, fontWeight:800, color:"#5B8DD9" }}>€{formatNumber(d.budget)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Ultimi lavori */}
            {assetWorkLogs.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>{t("asset.lastWork")}</div>
                {assetWorkLogs.slice(0, 2).map(log => (
                  <div key={log.id} style={{ background:"#faf9f7", borderRadius:8, padding:"8px 10px", marginBottom:6, border:"1px solid #e8e6e0" }}>
                    <div style={{ fontSize:12, fontWeight:700, color:"#2d2b26" }}>{log.title}</div>
                    <div style={{ fontSize:10, color:"#8a877f", marginTop:2 }}>
                      {log.date.toLocaleDateString(getLocale())}
                      {log.km && ` • ${log.km.toLocaleString(getLocale())} km`}
                      {log.cost > 0 && ` • €${formatNumber(log.cost)}`}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Documenti */}
            {allDocuments.length > 0 && (
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>{t("asset.documents", { count: allDocuments.length })}</div>
                {allDocuments.slice(0, 3).map(doc => (
                  <div key={doc.id} onClick={() => onViewDoc(doc)} style={{ background:"#faf9f7", borderRadius:8, padding:"6px 8px", marginBottom:4, fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                    <span>{doc.type === 'receipt' ? '🧾' : '📄'}</span>
                    <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{doc.filename}</span>
                  </div>
                ))}
                {allDocuments.length > 3 && (
                  <div style={{ fontSize:10, color:"#8a877f", textAlign:"center", marginTop:4 }}>
                    {t("asset.moreDocs", { count: allDocuments.length - 3 })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB: SCADENZE */}
        {tab === "scadenze" && (
          <div>
            {/* Add deadline button */}
            <div style={{ marginBottom:12 }}>
              <button onClick={() => {
                onClose();
                // Signal to parent to open AddSheet with this asset preset
                window.dispatchEvent(new CustomEvent('openAddSheetWithAsset', { 
                  detail: { catId, assetName } 
                }));
              }} style={{
                width:"100%", padding:"10px", borderRadius:10, border:"2px dashed #5B8DD9", background:"#EBF2FC",
                color:"#5B8DD9", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6
              }}>
                <span style={{ fontSize:16 }}>+</span> {t("asset.addDeadline", { asset: assetName })}
              </button>
            </div>

            <div style={{ background:"#f5f4f0", borderRadius:10, padding:"10px 12px", marginBottom:12, fontSize:11, color:"#6b6961" }}>
              {t("asset.deadlinesSummary", { total: assetDeadlines.length, completed: completed.length, upcoming: upcoming.length })}
            </div>

            {assetDeadlines.length === 0 ? (
              <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>📅</div>
                <div style={{ fontSize:14, fontWeight:600, color:"#8a877f", marginBottom:8 }}>{t("asset.emptyDeadlinesTitle")}</div>
                <div style={{ fontSize:12, color:"#b5b2a8" }}>{t("asset.emptyDeadlinesHint")}</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {assetDeadlines.map(d => (
                  <div key={d.id} style={{
                    background: d.done ? "#faf9f7" : "#EBF2FC",
                    borderRadius:10, padding:"10px 12px",
                    border: `1px solid ${d.done ? "#e8e6e0" : "#5B8DD966"}`,
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>{d.title}</div>
                        <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>
                          {d.date.toLocaleDateString(getLocale())}
                          {d.recurring && d.recurring.enabled && ` • ${d.recurring.index}/${d.recurring.total}`}
                        </div>
                        {d.notes && (
                          <div style={{ fontSize:10, color:"#6b6961", marginTop:4, fontStyle:"italic" }}>{d.notes}</div>
                        )}
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:14, fontWeight:800, color: d.done ? "#4CAF6E" : "#5B8DD9" }}>€{formatNumber(d.budget)}</div>
                        {d.done && (
                          <div style={{ fontSize:9, color:"#4CAF6E", fontWeight:600, marginTop:2 }}>{t("asset.completed")}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: REGISTRO */}
        {tab === "registro" && (
          <div>
            {/* Search bar */}
            {assetWorkLogs.length > 0 && (
              <div style={{ marginBottom:12, position:"relative" }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t("asset.searchPlaceholder")}
                  style={{
                    width:"100%", padding:"10px 36px 10px 12px", borderRadius:10, border:"1px solid #e8e6e0",
                    fontSize:13, fontFamily:"inherit", background:"#faf9f7"
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    style={{
                      position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                      background:"#e8e6e0", border:"none", borderRadius:"50%",
                      width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center",
                      cursor:"pointer", fontSize:12, color:"#6b6961", padding:0
                    }}
                  >×</button>
                )}
              </div>
            )}

            <div style={{ marginBottom:16 }}>
              <button onClick={() => setShowAddWork(true)} style={{
                width:"100%", padding:"12px", borderRadius:10, border:"2px dashed #5B8DD9", background:"#EBF2FC",
                color:"#5B8DD9", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6
              }}>
                <span style={{ fontSize:16 }}>+</span> {t("asset.addWork")}
              </button>
            </div>

            {assetWorkLogs.length === 0 ? (
              <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>🔧</div>
                <div style={{ fontSize:14, fontWeight:600, color:"#8a877f", marginBottom:6 }}>{t("asset.emptyWorkTitle")}</div>
                <div style={{ fontSize:12, color:"#b5b2a8" }}>{t("asset.emptyWorkHint")}</div>
              </div>
            ) : (
              (() => {
                // Filter work logs based on search query
                const filtered = assetWorkLogs.filter(log => {
                  if (!searchQuery) return true;
                  const q = searchQuery.toLowerCase();
                  return (
                    log.title.toLowerCase().includes(q) ||
                    (log.description && log.description.toLowerCase().includes(q))
                  );
                });

                return filtered.length === 0 ? (
                  <div style={{ textAlign:"center", padding:"30px 20px", color:"#b5b2a8" }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>🔍</div>
                    <div style={{ fontSize:13, color:"#8a877f" }}>{t("asset.noResults", { query: searchQuery })}</div>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {filtered.map(log => (
                  <div 
                    key={log.id} 
                    onClick={() => { setEditingWorkLog(log); setShowAddWork(true); }}
                    style={{ 
                      background:"#faf9f7", borderRadius:10, padding:"12px", border:"1px solid #e8e6e0",
                      cursor:"pointer", transition:"all .2s"
                    }}
                    onMouseOver={e => e.currentTarget.style.background = "#f0ede7"}
                    onMouseOut={e => e.currentTarget.style.background = "#faf9f7"}
                  >
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>{log.title}</div>
                        <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>
                          {log.date.toLocaleDateString(getLocale())}
                        </div>
                      </div>
                      {log.cost > 0 && (
                        <div style={{ fontSize:14, fontWeight:800, color:"#4CAF6E" }}>€{formatNumber(log.cost)}</div>
                      )}
                    </div>
                    
                    {isAuto && log.km && (
                      <div style={{ background:"#fff", borderRadius:6, padding:"6px 8px", marginBottom:6, fontSize:11, color:"#6b6961" }}>
                        {t("asset.kmLabel", { km: log.km.toLocaleString(getLocale()) })}
                        {log.nextKm && ` ${t("asset.kmNext", { km: log.nextKm.toLocaleString(getLocale()) })}`}
                      </div>
                    )}
                    
                    {log.description && (
                      <div style={{ fontSize:11, color:"#6b6961", marginTop:6, lineHeight:1.4 }}>{log.description}</div>
                    )}
                  </div>
                ))}
              </div>
                );
              })()
            )}
          </div>
        )}

        {/* Add Work Modal */}
        {showAddWork && (
          <AddWorkModal
            open={showAddWork}
            onClose={() => { setShowAddWork(false); setEditingWorkLog(null); }}
            assetKey={assetKey}
            assetName={assetName}
            catId={catId}
            isAuto={isAuto}
            workLog={editingWorkLog}
            onSave={(work) => {
              onAddWorkLog(assetKey, work, editingWorkLog?.id);
              setShowAddWork(false);
              setEditingWorkLog(null);
            }}
            onCreateDeadline={(formData) => {
              // Create a new deadline linked to this asset
              const newDeadline = {
                id: Date.now(),
                title: formData.title,
                cat: catId,
                asset: assetName,
                date: new Date(formData.date + "T00:00:00"),
                budget: formData.cost ? parseFloat(formData.cost) : 0,
                notes: formData.description || "",
                recurring: null,
                mandatory: false,
                autoPay: false,
                documents: [],
                done: false
              };
              // This will be handled by parent - need to pass it up
              // For now just close modal
              setShowAddWork(false);
              setEditingWorkLog(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ── ADD WORK MODAL ──────────────────────────────────── */
function AddWorkModal({ open, onClose, assetKey, assetName, catId, isAuto, onSave, onCreateDeadline, prefill, workLog }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: workLog?.title || prefill?.title || "",
    date: workLog?.date ? workLog.date.toISOString().split('T')[0] : (prefill?.date || new Date().toISOString().split('T')[0]),
    km: workLog?.km || "",
    nextKm: workLog?.nextKm || "",
    description: workLog?.description || prefill?.description || "",
    cost: workLog?.cost || prefill?.cost || ""
  });

  useEffect(() => {
    if (open) {
      if (workLog) {
        setForm({
          title: workLog.title,
          date: workLog.date.toISOString().split('T')[0],
          km: workLog.km || "",
          nextKm: workLog.nextKm || "",
          description: workLog.description || "",
          cost: workLog.cost || ""
        });
      } else if (prefill) {
        setForm({
          title: prefill.title || "",
          date: prefill.date || new Date().toISOString().split('T')[0],
          km: "",
          nextKm: "",
          description: prefill.description || "",
          cost: prefill.cost || ""
        });
      }
    }
  }, [open, prefill, workLog]);

  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const modeLabel = workLog ? t("workLog.edit") : t("workLog.new");

  const handleSave = () => {
    if (!form.title || !form.date) return;
    
    onSave({
      id: workLog?.id || Date.now(),
      title: form.title,
      date: new Date(form.date + "T00:00:00"),
      km: form.km ? parseInt(form.km) : null,
      nextKm: form.nextKm ? parseInt(form.nextKm) : null,
      description: form.description,
      cost: form.cost ? parseFloat(form.cost) : 0
    });
  };

  const inp = { width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid #e8e6e0", fontSize:13, fontFamily:"inherit" };
  const lbl = { display:"block", fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6, textTransform:"uppercase" };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"rgba(18,17,13,.7)", zIndex:250,
      display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:18, padding:"20px 22px", width:"90%", maxWidth:400,
        animation:"popIn .22s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"80vh", overflowY:"auto"
      }}>
        <style>{`@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
        
        <h3 style={{ margin:"0 0 16px", fontSize:17, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>
          {t("workLog.title", { mode: modeLabel, asset: assetName })}
        </h3>

        <label style={lbl}>{t("workLog.fields.title")}</label>
        <input value={form.title} onChange={e => set("title", e.target.value)} placeholder={t("workLog.placeholders.title")} style={inp}/>

        <label style={{ ...lbl, marginTop:12 }}>{t("workLog.fields.date")}</label>
        <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={inp}/>

        {isAuto && (
          <>
            <label style={{ ...lbl, marginTop:12 }}>{t("workLog.fields.mileage")}</label>
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1 }}>
                <input type="number" value={form.km} onChange={e => set("km", e.target.value)} placeholder={t("workLog.placeholders.kmCurrent")} style={inp}/>
              </div>
              <div style={{ flex:1 }}>
                <input type="number" value={form.nextKm} onChange={e => set("nextKm", e.target.value)} placeholder={t("workLog.placeholders.kmNext")} style={inp}/>
              </div>
            </div>
          </>
        )}

        <label style={{ ...lbl, marginTop:12 }}>{t("workLog.fields.description")}</label>
        <textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder={t("workLog.placeholders.description")} rows={3} style={{ ...inp, resize:"vertical" }}/>

        <label style={{ ...lbl, marginTop:12 }}>{t("workLog.fields.cost")}</label>
        <input type="number" value={form.cost} onChange={e => set("cost", e.target.value)} placeholder="0" style={inp}/>

        {/* Create Deadline button */}
        <button onClick={() => { onCreateDeadline(form); onClose(); }} style={{
          width:"100%", marginTop:16, padding:"10px", borderRadius:10, border:"2px dashed #5B8DD9", background:"#EBF2FC",
          color:"#5B8DD9", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6
        }}>
          {t("workLog.openDeadline")}
        </button>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>{t("actions.cancel")}</button>
          <button onClick={handleSave} disabled={!form.title || !form.date} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background: form.title && form.date ? "#2d2b26" : "#e8e6e0", color:"#fff", cursor: form.title && form.date ? "pointer" : "not-allowed", fontSize:14, fontWeight:700 }}>{t("actions.save")}</button>
        </div>
      </div>
    </div>
  );
}
function CategorySheet({ open, onClose, cats, onUpdateCats, deadlines, workLogs, onResetAll }) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState(null);
  const [newAsset, setNewAsset] = useState("");
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCat, setNewCat] = useState({ label:"", icon:"", color:"#E8855D" });

  if (!open) return null;

  const addAsset = (catId) => {
    if (!newAsset.trim()) return;
    onUpdateCats(cats.map(c => c.id === catId ? { ...c, assets: [...c.assets, newAsset.trim()] } : c));
    setNewAsset("");
  };

  const removeAsset = (catId, asset) => {
    onUpdateCats(cats.map(c => c.id === catId ? { ...c, assets: c.assets.filter(a => a !== asset) } : c));
  };

  const addCategory = () => {
    if (!newCat.label.trim() || !newCat.icon.trim()) return;
    const id = newCat.label.toLowerCase().replace(/\s+/g, '_');
    onUpdateCats([...cats, { 
      id, 
      label: newCat.label.trim(), 
      icon: newCat.icon.trim(), 
      color: newCat.color,
      light: newCat.color + "22",
      assets: [] 
    }]);
    setNewCat({ label:"", icon:"", color:"#E8855D" });
    setShowAddCat(false);
  };

  const deleteCategory = (catId) => {
    if (window.confirm(t("category.deleteConfirm"))) {
      onUpdateCats(cats.filter(c => c.id !== catId));
    }
  };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:200,
      display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:"24px 24px 0 0", padding:"0 20px 34px", width:"100%", maxWidth:480,
        animation:"sheetUp .28s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"85vh", overflowY:"auto",
      }}>
        <div style={{ width:44, height:5, background:"#e0ddd6", borderRadius:3, margin:"12px auto 16px" }}/>
        <h3 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{t("category.title")}</h3>

        {cats.map(cat => (
          <div key={cat.id} style={{ marginBottom:20, background:"#faf9f7", borderRadius:14, padding:"14px 16px", border:"1px solid #edecea" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <div style={{ width:40, height:40, borderRadius:10, background:cat.light, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, border:`2px solid ${cat.color}44` }}>
                {cat.icon}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:700, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{t(cat.labelKey || "", { defaultValue: cat.label })}</div>
                <div style={{ fontSize:11, color:"#8a877f" }}>
                  {cat.assets.length > 0 ? t("category.assetsCount", { count: cat.assets.length }) : t("category.generic")}
                </div>
              </div>
              <button onClick={() => setEditingId(editingId === cat.id ? null : cat.id)} style={{
                background: editingId === cat.id ? cat.color : cat.light,
                color: editingId === cat.id ? "#fff" : cat.color,
                border:"none", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:700, cursor:"pointer",
              }}>{editingId === cat.id ? t("actions.close") : t("actions.edit")}</button>
              {/* Elimina solo se custom (non nelle prime 6 default) */}
              {cats.indexOf(cat) >= 6 && (
                <button onClick={() => deleteCategory(cat.id)} style={{
                  background:"#FFF0EC", color:"#E53935", border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer",
                }}>🗑</button>
              )}
            </div>

            {editingId === cat.id && (
              <div style={{ borderTop:"1px solid #edecea", paddingTop:10 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase", marginBottom:6 }}>{t("category.assetsTitle")}</div>
                {cat.assets.length === 0 ? (
                  <div style={{ fontSize:12, color:"#b5b2a8", fontStyle:"italic", marginBottom:8 }}>{t("category.assetsEmpty")}</div>
                ) : (
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                    {cat.assets.map(a => (
                      <div key={a} style={{ background:"#fff", borderRadius:8, padding:"6px 10px", fontSize:12, fontWeight:600, color:"#2d2b26", border:"1px solid #e8e6e0", display:"flex", alignItems:"center", gap:6 }}>
                        {a}
                        <button onClick={() => removeAsset(cat.id, a)} style={{ background:"none", border:"none", color:"#E53935", fontSize:14, cursor:"pointer", padding:0, lineHeight:1 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:"flex", gap:6 }}>
                  <input
                    value={editingId === cat.id ? newAsset : ""}
                    onChange={e => setNewAsset(e.target.value)}
                    placeholder={t("category.newAssetPlaceholder")}
                    onKeyDown={e => e.key === "Enter" && addAsset(cat.id)}
                    style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:13, outline:"none", background:"#fff" }}
                  />
                  <button onClick={() => addAsset(cat.id)} style={{
                    background:cat.color, color:"#fff", border:"none", borderRadius:8, padding:"8px 14px", fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>{t("category.addAsset")}</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Nuova categoria */}
        {showAddCat ? (
          <div style={{ marginBottom:20, background:"#fff", borderRadius:14, padding:"14px 16px", border:"2px solid #5B8DD9" }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#2d2b26", marginBottom:12 }}>{t("category.newTitle")}</div>
            
            <label style={{ display:"block", fontSize:10, fontWeight:700, color:"#8a877f", marginBottom:5, textTransform:"uppercase" }}>{t("category.name")}</label>
            <input
              value={newCat.label}
              onChange={e => setNewCat({...newCat, label: e.target.value})}
              placeholder={t("category.namePlaceholder")}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:14, outline:"none", marginBottom:10 }}
            />

            <label style={{ display:"block", fontSize:10, fontWeight:700, color:"#8a877f", marginBottom:5, textTransform:"uppercase" }}>{t("category.emoji")}</label>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(44px, 1fr))", gap:8, marginBottom:12, maxHeight:200, overflowY:"auto" }}>
              {["🏠","🚗","👨‍👩‍👧","💰","🏥","📚","✈️","🍽️","🛒","💼","🎯","🎓","🏋️","🎨","🎵","🐕","🌱","🔧","📱","💻","⚡","🔑","📦","🎁"].map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setNewCat({...newCat, icon: emoji})}
                  style={{
                    padding:"10px", fontSize:22, background: newCat.icon === emoji ? "#EBF2FC" : "#f5f4f0",
                    border: newCat.icon === emoji ? "2px solid #5B8DD9" : "1px solid #e8e6e0",
                    borderRadius:8, cursor:"pointer", transition:"all .2s", aspectRatio:"1"
                  }}
                >{emoji}</button>
              ))}
            </div>

            <label style={{ display:"block", fontSize:10, fontWeight:700, color:"#8a877f", marginBottom:5, textTransform:"uppercase" }}>{t("category.color")}</label>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              {["#E8855D","#5B8DD9","#C77DBA","#4CAF6E","#F0B84D","#7B8BE8","#E53935","#9C27B0"].map(c => (
                <button key={c} onClick={() => setNewCat({...newCat, color: c})} style={{
                  width:36, height:36, borderRadius:"50%", background:c, border: newCat.color === c ? "3px solid #2d2b26" : "2px solid #e8e6e0", cursor:"pointer",
                }}/>
              ))}
            </div>

            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowAddCat(false)} style={{ flex:1, padding:"10px", borderRadius:8, border:"1px solid #e8e6e0", background:"#fff", color:"#6b6961", fontSize:13, fontWeight:600, cursor:"pointer" }}>{t("actions.cancel")}</button>
              <button onClick={addCategory} style={{ flex:1, padding:"10px", borderRadius:8, border:"none", background:"#5B8DD9", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>{t("category.create")}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddCat(true)} style={{
            width:"100%", padding:"14px", borderRadius:14, border:"2px dashed #e8e6e0", background:"transparent", color:"#8a877f", cursor:"pointer", fontSize:14, fontWeight:700, marginBottom:12,
          }}>{t("category.add")}</button>
        )}

        <button onClick={onClose} style={{ width:"100%", padding:"14px", borderRadius:14, border:"none", background:"#2d2b26", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, minHeight:48 }}>{t("actions.close")}</button>
        
        {/* Export/Import Data */}
        <div style={{ marginTop:20, paddingTop:20, borderTop:"2px solid #f5f4f0" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>{t("backup.title")}</div>
          
          <button onClick={() => {
            const data = {
              version: "1.0",
              exportDate: new Date().toISOString(),
              categories: cats,
              deadlines: deadlines,
              workLogs: workLogs
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lifetrack-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert(t("backup.exported"));
          }} style={{ 
            width:"100%", padding:"12px", borderRadius:14, border:"2px solid #5B8DD9", background:"#EBF2FC", color:"#5B8DD9", cursor:"pointer", fontSize:13, fontWeight:700, marginBottom:10, display:"flex", alignItems:"center", justifyContent:"center", gap:6
          }}>
            {t("backup.export")}
          </button>
          
          <label style={{ 
            width:"100%", padding:"12px", borderRadius:14, border:"2px solid #4CAF6E", background:"#E8F5E9", color:"#4CAF6E", cursor:"pointer", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", gap:6
          }}>
            <input type="file" accept=".json" style={{ display:"none" }} onChange={(e) => {
              const file = e.target.files[0];
              if (!file) return;
              
              const reader = new FileReader();
              reader.onload = (event) => {
                try {
                  const data = JSON.parse(event.target.result);
                  
                  // Validate data structure
                  if (!data.categories || !data.deadlines) {
                    alert(t("backup.invalidFile"));
                    return;
                  }
                  
                  // Confirm import
                  if (!window.confirm(t("backup.importConfirm", { deadlines: data.deadlines.length, categories: data.categories.length }))) {
                    return;
                  }
                  
                  // Import data
                  localStorage.setItem('lifetrack_categories', JSON.stringify(data.categories));
                  localStorage.setItem('lifetrack_deadlines', JSON.stringify(data.deadlines));
                  localStorage.setItem('lifetrack_worklogs', JSON.stringify(data.workLogs || {}));
                  
                  alert(t("backup.imported"));
                  window.location.reload();
                } catch (err) {
                  alert(t("backup.readError", { message: err.message }));
                }
              };
              reader.readAsText(file);
              e.target.value = ''; // Reset input
            }} />
            {t("backup.import")}
          </label>
          
          <div style={{ fontSize:10, color:"#8a877f", marginTop:8, lineHeight:1.4 }}>
            💡 <strong>{t("backup.shareTipTitle")}</strong> {t("backup.shareTip")}
          </div>
        </div>
        
        {/* Reset button for testing */}
        <button onClick={() => {
          if (window.confirm(t("backup.resetConfirm"))) {
            localStorage.removeItem('lifetrack_categories');
            localStorage.removeItem('lifetrack_deadlines');
            window.location.reload();
          }
        }} style={{ 
          width:"100%", padding:"12px", borderRadius:14, border:"1px solid #FBE9E7", background:"#FFF0EC", color:"#E53935", cursor:"pointer", fontSize:12, fontWeight:600, marginTop:10 
        }}>{t("backup.reset")}</button>
        {onResetAll && (
          <button onClick={onResetAll} style={{ 
            width:"100%", padding:"12px", borderRadius:14, border:"1px solid #E53935", background:"#E53935", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, marginTop:8 
          }}>{t("backup.resetCloud")}</button>
        )}
      </div>
    </div>
  );
}

/* ── APP ROOT ──────────────────────────────────────────── */
export default function App() {
  const { t, i18n } = useTranslation();
  // 🔥 Firebase State
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const suppressDeadlinesRef = useRef(false);
  const suppressMetaRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const needsSaveRef = useRef(false);
  const deadlinesRef = useRef([]);
  const prevDeadlinesRef = useRef([]);
  const saveRetryRef = useRef(null);
  const deadlinesSaveTimerRef = useRef(null);
  const syncingCountRef = useRef(0);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState("login"); // login | signup
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  // App state (must be declared before any hooks that reference them)
  const [cats, setCats] = useState(DEFAULT_CATS);
  const [deadlines, setDeadlines] = useState([]);
  const [workLogs, setWorkLogs] = useState(() => {
    const saved = localStorage.getItem('lifetrack_worklogs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return normalizeWorkLogs(parsed);
      } catch (err) {
        console.warn("WorkLogs parse error:", err);
      }
    }
    return {}; // { "casa_colico": [...], "auto_micro": [...] }
  });

  useEffect(() => {
    deadlinesRef.current = deadlines;
  }, [deadlines]);

  const startSync = () => {
    syncingCountRef.current += 1;
    setSyncing(true);
  };

  const endSync = () => {
    syncingCountRef.current = Math.max(0, syncingCountRef.current - 1);
    if (syncingCountRef.current === 0) setSyncing(false);
  };

  // 🔥 Firebase Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || null);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 🔥 Firebase Sync (polling per-document)
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const deadlinesCol = collection(db, 'users', user.uid, 'deadlines');
    let cancelled = false;

    const migrateLegacyDeadlines = async (data) => {
      const legacy = data?.deadlines || [];
      const alreadyMigrated = data?.schemaVersion >= 2;
      if (!legacy.length || alreadyMigrated) return false;
      const batch = writeBatch(db);
      legacy.forEach(d => {
        const rawId = d.id ?? Date.now();
        const docId = String(rawId);
        batch.set(doc(db, 'users', user.uid, 'deadlines', docId), { ...d, id: d.id ?? rawId }, { merge: true });
      });
      batch.set(userRef, { schemaVersion: 2, migratedAt: new Date().toISOString() }, { merge: true });
      await batch.commit();
      return true;
    };

    const seedDeadlines = async (items) => {
      if (!items.length) return false;
      const batch = writeBatch(db);
      const now = Date.now();
      items.forEach((d, i) => {
        const rawId = d.id ?? `${now}_${i}`;
        const docId = String(rawId);
        batch.set(
          doc(db, 'users', user.uid, 'deadlines', docId),
          { ...d, id: d.id ?? rawId, updatedAt: now },
          { merge: true }
        );
      });
      batch.set(userRef, { schemaVersion: 2, migratedAt: new Date().toISOString() }, { merge: true });
      await batch.commit();
      return true;
    };

    const fetchOnce = async () => {
      try {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        if (!userSnap.exists()) {
          await setDoc(userRef, { categories: DEFAULT_CATS, workLogs: {}, schemaVersion: 2, createdAt: new Date().toISOString() }, { merge: true });
        }
        await migrateLegacyDeadlines(userData);

        const deadlinesSnap = await getDocs(deadlinesCol);
        let remoteDeadlines = deadlinesSnap.docs
          .map(snap => {
            const data = snap.data();
            const id = data.id ?? snap.id;
            return normalizeDeadline({ ...data, id });
          })
          .filter(Boolean);
        const parsedWorkLogs = normalizeWorkLogs(userData.workLogs);

        if (remoteDeadlines.length === 0) {
          const legacyDeadlines = (userData.deadlines || [])
            .map(normalizeDeadline)
            .filter(Boolean);
          let localDeadlines = [];
          const localRaw = localStorage.getItem('lifetrack_deadlines');
          if (localRaw) {
            try {
              const parsedLocal = JSON.parse(localRaw);
              if (Array.isArray(parsedLocal)) {
                localDeadlines = parsedLocal.map(normalizeDeadline).filter(Boolean);
              }
            } catch (err) {
              console.warn("Local deadlines parse error:", err);
            }
          }
          const fallback = legacyDeadlines.length ? legacyDeadlines : localDeadlines;
          if (fallback.length) {
            try {
              await seedDeadlines(fallback);
              remoteDeadlines = fallback;
            } catch (err) {
              console.error("Deadline seed error:", err);
              remoteDeadlines = fallback;
            }
          }
        }

        if (!cancelled && !pendingSaveRef.current) {
          suppressDeadlinesRef.current = true;
          suppressMetaRef.current = true;
          setDeadlines(remoteDeadlines);
          setCats(userData.categories || DEFAULT_CATS);
          setWorkLogs(parsedWorkLogs);
        }
      } catch (error) {
        console.error("Firebase poll error:", error);
      }
    };

    fetchOnce();
    const interval = setInterval(fetchOnce, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  const saveDeadlines = async (force = false) => {
    if (!user || loading) return;
    if (pendingSaveRef.current && !force) return;
    pendingSaveRef.current = true;
    startSync();
    const current = deadlinesRef.current || [];
    const prev = prevDeadlinesRef.current || [];
    const prevIds = new Set(prev.map(d => String(d.id)));
    const nextIds = new Set(current.map(d => String(d.id)));
    const removedIds = [...prevIds].filter(id => !nextIds.has(id));

    try {
      const batch = writeBatch(db);
      const now = Date.now();
      current.forEach(d => {
        const docId = String(d.id);
        batch.set(doc(db, 'users', user.uid, 'deadlines', docId), { ...d, id: d.id, updatedAt: now }, { merge: true });
      });
      removedIds.forEach(id => {
        batch.delete(doc(db, 'users', user.uid, 'deadlines', id));
      });
      await batch.commit();
      prevDeadlinesRef.current = current;
      pendingSaveRef.current = false;
      if (saveRetryRef.current) {
        clearTimeout(saveRetryRef.current);
        saveRetryRef.current = null;
      }
      endSync();
      if (needsSaveRef.current) {
        needsSaveRef.current = false;
        if (deadlinesSaveTimerRef.current) clearTimeout(deadlinesSaveTimerRef.current);
        deadlinesSaveTimerRef.current = setTimeout(() => saveDeadlines(), 800);
      }
    } catch (error) {
      console.error("Firebase deadline save error:", error);
      endSync();
      if (!saveRetryRef.current) {
        saveRetryRef.current = setTimeout(() => {
          saveRetryRef.current = null;
          saveDeadlines(true);
        }, 5000);
      }
    }
  };

  // 🔥 Firebase Auto-Save (deadlines)
  useEffect(() => {
    if (!user || loading) return;
    if (suppressDeadlinesRef.current) {
      suppressDeadlinesRef.current = false;
      prevDeadlinesRef.current = deadlines;
      return;
    }
    if (pendingSaveRef.current) {
      needsSaveRef.current = true;
      return;
    }
    if (deadlinesSaveTimerRef.current) clearTimeout(deadlinesSaveTimerRef.current);
    deadlinesSaveTimerRef.current = setTimeout(() => saveDeadlines(), 800);
    return () => clearTimeout(deadlinesSaveTimerRef.current);
  }, [deadlines, user, loading]);

  // 🔥 Firebase Auto-Save (categories + worklogs)
  useEffect(() => {
    if (!user || loading) return;
    if (suppressMetaRef.current) {
      suppressMetaRef.current = false;
      return;
    }
    const saveTimer = setTimeout(async () => {
      try {
        startSync();
        await setDoc(doc(db, 'users', user.uid), {
          categories: cats,
          workLogs,
          schemaVersion: 2,
          lastUpdate: new Date().toISOString()
        }, { merge: true });
        endSync();
      } catch (error) {
        console.error("Firebase save error:", error);
        endSync();
      }
    }, 1000);
    return () => clearTimeout(saveTimer);
  }, [cats, workLogs, user, loading]);

  // Save to localStorage whenever cats or deadlines change
  useEffect(() => {
    localStorage.setItem('lifetrack_categories', JSON.stringify(cats));
  }, [cats]);

  useEffect(() => {
    localStorage.setItem('lifetrack_deadlines', JSON.stringify(deadlines));
  }, [deadlines]);

  useEffect(() => {
    localStorage.setItem('lifetrack_worklogs', JSON.stringify(workLogs));
  }, [workLogs]);

  // Listen for openAddSheetWithAsset event from AssetSheet
  useEffect(() => {
    const handleOpenAddWithAsset = (e) => {
      setPresetAsset(e.detail);
      setShowAdd(true);
    };
    window.addEventListener('openAddSheetWithAsset', handleOpenAddWithAsset);
    return () => window.removeEventListener('openAddSheetWithAsset', handleOpenAddWithAsset);
  }, []);

  // Auto-complete autopay deadlines
  useEffect(() => {
    const autoCompleteDeadlines = () => {
      const now = new Date(); now.setHours(0,0,0,0);
      let updated = false;
      
      const newDeadlines = deadlines.map(d => {
        // Se ha autoPay attivo, non è completata, e la data è passata → auto-completa
        if (d.autoPay && !d.done && d.date < now) {
          updated = true;
          return { ...d, done: true, autoCompleted: true }; // flag per sapere che è stata auto-completata
        }
        return d;
      });
      
      if (updated) {
        setDeadlines(newDeadlines);
        const count = newDeadlines.filter(d => d.autoCompleted && d.done).length - deadlines.filter(d => d.autoCompleted && d.done).length;
        if (count > 0) {
          showToast(t("toast.autoPayCompleted", { count }));
        }
      }
    };
    
    // Esegui al mount e ogni volta che cambiano le deadlines (ma solo se non è un update da auto-complete stesso)
    const timer = setTimeout(autoCompleteDeadlines, 500);
    return () => clearTimeout(timer);
  }, [deadlines.length]); // Dipende solo dalla lunghezza per evitare loop infiniti

  const [range, setRange] = useState("mese");
  const [filterCat, setFilterCat] = useState(null);
  const [filterAsset, setFilterAsset] = useState(null);
  const [filterMandatory, setFilterMandatory] = useState(false);
  const [filterRecurring, setFilterRecurring] = useState(false);
  const [filterAutoPay, setFilterAutoPay] = useState(false);
  const [filterEssential, setFilterEssential] = useState(false);
  const [filterEstimateMissing, setFilterEstimateMissing] = useState(false);
  const [expandedFilterCat, setExpandedFilterCat] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(null); // For editing existing deadlines
  const [editConfirm, setEditConfirm] = useState(null); // { item, form }
  const [presetAsset, setPresetAsset] = useState(null); // { catId, assetName }
  const [showCats, setShowCats] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showAsset, setShowAsset] = useState(null); // { cat, asset }
  const [showAssetList, setShowAssetList] = useState(false);
  const [activeTab, setActiveTab] = useState("timeline");
  const [toast, setToast] = useState(null);
  const [postponeId, setPostponeId] = useState(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [paymentFlow, setPaymentFlow] = useState(null); // { itemId, step: 'choose'|'partial'|'downpayment' }
  const [workLogPrompt, setWorkLogPrompt] = useState(null); // { item, assetKey }
  const [paymentAmount, setPaymentAmount] = useState("");
  const [downpaymentDate, setDownpaymentDate] = useState("");
  const [viewingDoc, setViewingDoc] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { itemId, futureCount }

  const editScheduleChanged = editConfirm ? (() => {
    const { item, form } = editConfirm;
    const interval = Math.max(1, parseInt(form.recurringInterval) || 1);
    const count = Math.max(1, parseInt(form.recurringCount) || 1);
    const formEndMode = form.recurringEndMode || "auto";
    const itemEndMode = inferEndMode(item.recurring);
    const itemEndDate = item.recurring?.endDate || "";
    const itemDateStr = item.date instanceof Date
      ? item.date.toISOString().split('T')[0]
      : new Date(item.date).toISOString().split('T')[0];
    const endModeChanged = formEndMode !== itemEndMode;
    const endDateChanged = formEndMode === "date" && form.recurringEndDate !== itemEndDate;
    const countChanged = formEndMode === "count" && count !== item.recurring.total;
    return (
      form.date !== itemDateStr ||
      interval !== item.recurring.interval ||
      form.recurringUnit !== item.recurring.unit ||
      endModeChanged ||
      endDateChanged ||
      countChanged
    );
  })() : false;

  // Show toast helper
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const resetCloudData = async () => {
    if (!user) return;
    if (!window.confirm(t("backup.resetCloudConfirm"))) return;
    try {
      startSync();
      localStorage.removeItem('lifetrack_categories');
      localStorage.removeItem('lifetrack_deadlines');
      localStorage.removeItem('lifetrack_worklogs');
      suppressDeadlinesRef.current = true;
      suppressMetaRef.current = true;
      setDeadlines([]);
      setCats(DEFAULT_CATS);
      setWorkLogs({});
      prevDeadlinesRef.current = [];
      pendingSaveRef.current = true;

      const userRef = doc(db, 'users', user.uid);
      const deadlinesCol = collection(db, 'users', user.uid, 'deadlines');
      const snap = await getDocs(deadlinesCol);
      const docs = snap.docs || [];
      const chunkSize = 400;
      for (let i = 0; i < docs.length; i += chunkSize) {
        const batch = writeBatch(db);
        docs.slice(i, i + chunkSize).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await setDoc(userRef, {
        categories: DEFAULT_CATS,
        workLogs: {},
        deadlines: [],
        schemaVersion: 2,
        lastUpdate: new Date().toISOString()
      }, { merge: true });
      pendingSaveRef.current = false;
      needsSaveRef.current = false;
      showToast(t("toast.resetDone"));
    } catch (error) {
      console.error("Reset cloud data error:", error);
      pendingSaveRef.current = false;
      needsSaveRef.current = false;
      showToast(t("toast.resetError"));
    } finally {
      endSync();
    }
  };

  const maxDays = RANGES.find(r => r.id === range)?.days || 30;

  const filtered = useMemo(() => {
    let list = deadlines.filter(d => {
      const days = diffDays(d.date);
      if (activeTab === "done") return d.done;
      if (activeTab === "overdue") return days < 0 && !d.done; // scadute non completate
      if (activeTab === "timeline") return days >= 0 && days <= maxDays && !d.done;
      return true;
    });
    if (filterCat) list = list.filter(d => d.cat === filterCat);
    if (filterAsset) list = list.filter(d => d.asset === filterAsset);
    if (filterMandatory) list = list.filter(d => d.mandatory);
    if (filterRecurring) list = list.filter(d => d.recurring && d.recurring.enabled);
    if (filterAutoPay) list = list.filter(d => d.autoPay);
    if (filterEssential) list = list.filter(d => d.essential);
    if (filterEstimateMissing) list = list.filter(d => d.estimateMissing);
    list.sort((a, b) => a.date - b.date);
    return list;
  }, [deadlines, range, filterCat, filterAsset, filterMandatory, filterRecurring, filterAutoPay, filterEssential, filterEstimateMissing, activeTab, maxDays]);

  const groups = useMemo(() => groupItems(filtered, range), [filtered, range]);

  const toggle   = id => setExpandedId(prev => prev === id ? null : id);
  
  const complete = id => {
    const item = deadlines.find(d => d.id === id);
    if (!item) return;
    
    // Se ha budget > 0 e non è già completata, apri il flow di pagamento
    if (item.budget > 0 && !item.done) {
      setPaymentFlow({ itemId: id, step: 'choose' });
      setPaymentAmount(String(item.budget)); // default = budget previsto
    } else {
      // Budget = 0 o riattivazione: completa direttamente
      setDeadlines(p => p.map(d => d.id === id ? { 
        ...d, 
        done: !d.done, 
        skipped: d.done ? false : d.skipped 
      } : d));
      setExpandedId(null);
    }
  };

  const skip = id => {
    const item = deadlines.find(d => d.id === id);
    if (!item || item.done) return;
    setDeadlines(p => p.map(d => d.id === id ? { ...d, done: true, skipped: true } : d));
    setExpandedId(null);
    showToast(t("toast.deadlineSkipped"));
  };
  
  const confirmPayment = (type) => {
    const item = deadlines.find(d => d.id === paymentFlow.itemId);
    if (!item) return;
    
    switch(type) {
      case 'full': // Pagata per intero al budget previsto
        setDeadlines(p => p.map(d => d.id === item.id ? { ...d, done: true, estimateMissing: false } : d));
        showToast(t("toast.paidFull", { amount: item.budget }));
        break;
        
      case 'not_paid': // Non pagata - azzera budget
        setDeadlines(p => p.map(d => d.id === item.id ? { ...d, done: true, budget: 0, estimateMissing: false } : d));
        showToast(t("toast.notPaid"));
        break;
        
      case 'partial': // Importo diverso - aggiorna budget con importo reale
        const amount = Number(paymentAmount) || 0;
        setDeadlines(p => p.map(d => d.id === item.id ? { ...d, done: true, budget: amount, estimateMissing: false } : d));
        showToast(t("toast.paidAmount", { amount }));
        break;
        
      case 'downpayment': // Acconto
        const downAmount = Number(paymentAmount) || 0;
        const remaining = item.budget - downAmount;
        
        // Completa la scadenza originale con il budget = acconto pagato
        setDeadlines(p => [
          ...p.map(d => d.id === item.id ? { ...d, done: true, budget: downAmount, estimateMissing: false } : d),
          // Crea scadenza per il saldo
          {
            id: Date.now(),
            title: `Saldo ${item.title}`,
            cat: item.cat,
            asset: item.asset,
            date: new Date(downpaymentDate + "T00:00:00"),
            budget: remaining,
            estimateMissing: false,
            notes: `Saldo rimanente (acconto €${downAmount} pagato)`,
            recurring: "Mai più",
            mandatory: item.mandatory,
            autoPay: item.autoPay, // eredita il flag autoPay
            documents: [],
            done: false
          }
        ]);
        showToast(t("toast.downpaymentCreated", { down: downAmount, remaining }));
        break;
    }
    
    setPaymentFlow(null);
    setPaymentAmount("");
    setDownpaymentDate("");
    setExpandedId(null);
  };

  const buildFieldsFromForm = (form) => {
    const estimateMissing = form.budget === "";
    const budgetValue = estimateMissing ? 0 : (Number(form.budget) || 0);
    return {
      title: form.title,
      cat: form.cat,
      asset: form.asset,
      budget: budgetValue,
      estimateMissing,
      notes: form.notes,
      mandatory: form.mandatory,
      essential: form.essential,
      autoPay: form.autoPay,
    };
  };

  const handleUpdateDeadline = (form) => {
    if (!editingDeadline) return;
    const item = editingDeadline;
    const fields = buildFieldsFromForm(form);

    if (item.recurring && item.recurring.enabled) {
      setEditConfirm({ item, form });
      return;
    }

    if (form.recurringEnabled) {
      const seriesId = `series_${Date.now()}`;
      const startDate = new Date(form.date + "T00:00:00");
      const schedule = resolveRecurringSchedule(form, startDate);
      const baseAmount = Number(form.budget) || 0;
      const newSeries = [];
      schedule.dates.forEach((occurrenceDate, i) => {
        newSeries.push({
          id: Date.now() + i,
          ...fields,
          date: occurrenceDate,
          documents: i === 0 ? form.documents : [],
          done: false,
          recurring: {
            enabled: true,
            interval: schedule.interval,
            unit: schedule.unit,
            seriesId,
            index: i + 1,
            total: schedule.total,
            baseAmount,
            endMode: schedule.endMode,
            endDate: schedule.endDate,
            preset: form.recurringPreset,
          }
        });
      });
      setDeadlines(p => [...p.filter(d => d.id !== item.id), ...newSeries]);
    } else {
      const newDate = new Date(form.date + "T00:00:00");
      setDeadlines(p => p.map(d => d.id === item.id ? {
        ...d,
        ...fields,
        date: newDate,
        documents: form.documents,
        recurring: null,
      } : d));
    }

    setEditingDeadline(null);
  };

  const applyEditScope = (scope) => {
    if (!editConfirm) return;
    const { item, form } = editConfirm;
    const seriesId = item.recurring?.seriesId;
    const currentIndex = item.recurring?.index || 1;
    const baseAmount = Number(form.budget) || 0;
    const fields = buildFieldsFromForm(form);
    const newDate = new Date(form.date + "T00:00:00");
    const schedule = resolveRecurringSchedule(form, newDate);
    const interval = schedule.interval;
    const formEndMode = schedule.endMode;
    const itemEndMode = inferEndMode(item.recurring);
    const itemEndDate = item.recurring?.endDate || "";
    const itemDateStr = item.date instanceof Date
      ? item.date.toISOString().split('T')[0]
      : new Date(item.date).toISOString().split('T')[0];
    const scheduleChanged =
      form.date !== itemDateStr ||
      interval !== item.recurring.interval ||
      schedule.unit !== item.recurring.unit ||
      formEndMode !== itemEndMode ||
      (formEndMode === "date" && schedule.endDate !== itemEndDate) ||
      (formEndMode === "count" && schedule.count !== item.recurring.total);

    const buildSeries = (dates, startIdx, total) => {
      return dates.map((occurrenceDate, i) => ({
        id: Date.now() + i,
        ...fields,
        date: occurrenceDate,
        documents: i === 0 ? form.documents : [],
        done: false,
        recurring: {
          enabled: true,
          interval: schedule.interval,
          unit: schedule.unit,
          seriesId,
          index: startIdx + i,
          total,
          baseAmount,
          endMode: schedule.endMode,
          endDate: schedule.endDate,
          preset: form.recurringPreset,
        }
      }));
    };

    if (scope === "single") {
      setDeadlines(p => p.map(d => d.id === item.id ? {
        ...d,
        ...fields,
        date: newDate,
        documents: form.documents,
        recurring: null,
      } : d));
    } else if (scope === "future") {
      if (!form.recurringEnabled) {
        setDeadlines(p => p.map(d => {
          if (!d.recurring || d.recurring.seriesId !== seriesId) return d;
          if (d.recurring.index < currentIndex) return d;
          const isCurrent = d.id === item.id;
          return {
            ...d,
            ...fields,
            date: isCurrent ? newDate : d.date,
            documents: isCurrent ? form.documents : d.documents,
            recurring: null,
          };
        }));
      } else {
        setDeadlines(p => {
          const others = p.filter(d => !d.recurring || d.recurring.seriesId !== seriesId);
          const past = p.filter(d => d.recurring && d.recurring.seriesId === seriesId && d.recurring.index < currentIndex);
          const futureDates = schedule.dates;
          const newTotal = past.length + futureDates.length;
          const updatedPast = past.map(d => ({
            ...d,
            recurring: {
              ...d.recurring,
              interval: schedule.interval,
              unit: schedule.unit,
              total: newTotal,
              baseAmount,
              endMode: schedule.endMode,
              endDate: schedule.endDate,
              preset: form.recurringPreset,
            }
          }));
          const future = buildSeries(futureDates, currentIndex, newTotal);
          return [...others, ...updatedPast, ...future];
        });
      }
    } else if (scope === "all") {
      if (!form.recurringEnabled) {
        setDeadlines(p => p.map(d => {
          if (!d.recurring || d.recurring.seriesId !== seriesId) return d;
          const isCurrent = d.id === item.id;
          return {
            ...d,
            ...fields,
            date: isCurrent ? newDate : d.date,
            documents: isCurrent ? form.documents : d.documents,
            recurring: null,
          };
        }));
      } else if (scheduleChanged) {
        setDeadlines(p => {
          const others = p.filter(d => !d.recurring || d.recurring.seriesId !== seriesId);
          const regenerated = buildSeries(schedule.dates, 1, schedule.total);
          return [...others, ...regenerated];
        });
      } else {
        setDeadlines(p => p.map(d => {
          if (!d.recurring || d.recurring.seriesId !== seriesId) return d;
          return {
            ...d,
            ...fields,
            documents: d.id === item.id ? form.documents : d.documents,
            recurring: {
              ...d.recurring,
              interval: schedule.interval,
              unit: schedule.unit,
              total: d.recurring.total,
              baseAmount,
              endMode: schedule.endMode,
              endDate: schedule.endDate,
              preset: form.recurringPreset,
            }
          };
        }));
      }
    }

    setEditConfirm(null);
    setEditingDeadline(null);
    setExpandedId(null);
  };
  
  const del = id => {
    const item = deadlines.find(d => d.id === id);
    if (!item) return;
    
    // Se fa parte di una serie, mostra modal conferma
    if (item.recurring && item.recurring.enabled && item.recurring.total > 1) {
      const seriesId = item.recurring.seriesId;
      const currentIndex = item.recurring.index;
      
      // Trova tutte le occorrenze della serie
      const seriesItems = deadlines.filter(d => d.recurring && d.recurring.seriesId === seriesId);
      
      // Conta quante future (inclusa questa)
      const futureItems = seriesItems.filter(d => d.recurring.index >= currentIndex);
      
      // Solo se ci sono altre occorrenze future
      if (futureItems.length > 1) {
        // Mostra modal di conferma
        setDeleteConfirm({
          itemId: id,
          itemTitle: item.title,
          seriesId: seriesId,
          currentIndex: currentIndex,
          futureCount: futureItems.length,
          recurringIndex: item.recurring.index,
          recurringTotal: item.recurring.total
        });
      } else {
        // È l'ultima della serie, elimina direttamente
        setDeadlines(p => p.filter(d => d.id !== id));
        setExpandedId(null);
        showToast(t("toast.deadlineDeleted"));
      }
    } else {
      // Non fa parte di una serie, elimina direttamente
      setDeadlines(p => p.filter(d => d.id !== id));
      setExpandedId(null);
      showToast(t("toast.deadlineDeleted"));
    }
  };
  
  const confirmDelete = () => {
    if (!deleteConfirm) return;
    
    // Elimina questa + tutte le future
    setDeadlines(p => p.filter(d => 
      !d.recurring || 
      d.recurring.seriesId !== deleteConfirm.seriesId || 
      d.recurring.index < deleteConfirm.currentIndex
    ));
    setExpandedId(null);
    showToast(t("toast.futureDeleted", { count: deleteConfirm.futureCount }));
    setDeleteConfirm(null);
  };
  const add = items => { 
    const itemsArray = Array.isArray(items) ? items : [items];
    setDeadlines(p => [...p, ...itemsArray]); 
    
    // Check if any deadline is outside current range
    const outsideRange = itemsArray.filter(item => diffDays(item.date) > maxDays);
    if (outsideRange.length > 0) {
      const rangeInfo = RANGES.find(r => r.id === range);
      const rangeLabel = rangeInfo ? t(rangeInfo.labelKey, { defaultValue: rangeInfo.label }) : range;
      if (itemsArray.length > 1) {
        showToast(t("toast.seriesCreatedRange", { outside: outsideRange.length, total: itemsArray.length, range: rangeLabel }));
      } else {
        showToast(t("toast.deadlineAddedOutside", { range: rangeLabel }));
      }
    } else if (itemsArray.length > 1) {
      showToast(t("toast.seriesCreated", { count: itemsArray.length }));
    }
  };
  
  const postpone = id => {
    setPostponeId(id);
    // Suggerisci +7 giorni da oggi
    const suggested = new Date(TODAY);
    suggested.setDate(suggested.getDate() + 7);
    setPostponeDate(suggested.toISOString().split('T')[0]);
  };
  
  const confirmPostpone = () => {
    if (postponeDate) {
      setDeadlines(p => p.map(d => d.id === postponeId ? { ...d, date: new Date(postponeDate + "T00:00:00") } : d));
      showToast(t("toast.deadlinePostponed"));
    }
    setPostponeId(null);
    setPostponeDate("");
    setExpandedId(null);
  };
  
  // Upload document to deadline
  const handleDocumentUpload = async (deadlineId, type, file) => {
    try {
      const base64 = await compressImage(file);
      const doc = {
        id: Date.now(),
        type, // 'incoming' or 'receipt'
        base64,
        filename: file.name,
        uploadDate: new Date().toISOString()
      };
      setDeadlines(p => p.map(d => d.id === deadlineId ? { ...d, documents: [...(d.documents || []), doc] } : d));
      showToast(t("toast.documentAttached"));
    } catch(err) {
      showToast(t("toast.documentUploadError"));
    }
  };
  
  const deleteDocument = (deadlineId, docId) => {
    setDeadlines(p => p.map(d => d.id === deadlineId ? { ...d, documents: d.documents.filter(doc => doc.id !== docId) } : d));
    showToast(t("toast.documentDeleted"));
  };

  const handleAuth = async () => {
    if (!authEmail || !authPassword) {
      setAuthError(t("auth.errors.missing"));
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      if (authMode === "signup") {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (error) {
      const code = error?.code || "";
      let msg = t("auth.errors.generic");
      if (code.includes("auth/invalid-email")) msg = t("auth.errors.invalidEmail");
      else if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) msg = t("auth.errors.invalidCreds");
      else if (code.includes("auth/user-not-found")) msg = t("auth.errors.userNotFound");
      else if (code.includes("auth/email-already-in-use")) msg = t("auth.errors.emailInUse");
      else if (code.includes("auth/weak-password")) msg = t("auth.errors.weakPassword");
      setAuthError(msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const shareDocument = async (doc) => {
    if (!doc) return;
    const defaultFilename = t("docs.defaultFilename");
    const defaultTitle = t("docs.defaultTitle");
    if (!navigator.share) {
      showToast(t("toast.shareUnsupported"));
      return;
    }
    try {
      const response = await fetch(doc.base64);
      const blob = await response.blob();
      const file = new File([blob], doc.filename || defaultFilename, { type: blob.type || "image/jpeg" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        await navigator.share({ title: doc.filename || defaultTitle, url: doc.base64 });
        return;
      }
      await navigator.share({ files: [file], title: doc.filename || defaultTitle });
    } catch (error) {
      console.error("Share error:", error);
      showToast(t("toast.shareError"));
    }
  };

  // 🔥 Loading Screen (after all hooks)
  if (loading) {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#1e1c18", color:"#fff" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📅</div>
          <div style={{ fontSize:20, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>LifeTrack</div>
          <div style={{ fontSize:13, opacity:.5, marginTop:8 }}>{t("app.loading")}</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#1e1c18", color:"#fff", padding:20 }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap');
          *{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
        `}</style>
        <div style={{ width:"100%", maxWidth:360 }}>
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
            <LanguageToggle size={26} />
          </div>
          <div style={{ background:"#2d2b26", borderRadius:18, padding:"22px 20px", boxShadow:"0 10px 30px rgba(0,0,0,.35)" }}>
          <div style={{ textAlign:"center", marginBottom:16 }}>
            <div style={{ fontSize:40, marginBottom:6 }}>📅</div>
            <div style={{ fontSize:18, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>{t("app.name")}</div>
            <div style={{ fontSize:12, opacity:.6, marginTop:4 }}>{t("auth.subtitle")}</div>
          </div>

          <label style={{ display:"block", fontSize:10, fontWeight:700, color:"rgba(255,255,255,.55)", marginBottom:6, letterSpacing:".6px", textTransform:"uppercase" }}>{t("auth.email")}</label>
          <input
            type="email"
            value={authEmail}
            onChange={e => setAuthEmail(e.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #3a3731", background:"#1f1d19", color:"#fff", marginBottom:12, fontSize:14, outline:"none" }}
          />

          <label style={{ display:"block", fontSize:10, fontWeight:700, color:"rgba(255,255,255,.55)", marginBottom:6, letterSpacing:".6px", textTransform:"uppercase" }}>{t("auth.password")}</label>
          <input
            type="password"
            value={authPassword}
            onChange={e => setAuthPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #3a3731", background:"#1f1d19", color:"#fff", marginBottom:12, fontSize:14, outline:"none" }}
          />

          {authError && (
            <div style={{ background:"rgba(229,57,53,.15)", color:"#ffb3ad", padding:"8px 10px", borderRadius:10, fontSize:12, marginBottom:10 }}>
              {authError}
            </div>
          )}

          <button
            onClick={handleAuth}
            disabled={authBusy}
            style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:"#E8855D", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", opacity: authBusy ? 0.7 : 1 }}
          >
            {authMode === "signup" ? t("auth.signup") : t("auth.login")}
          </button>

          <div style={{ marginTop:12, textAlign:"center", fontSize:12, color:"rgba(255,255,255,.6)" }}>
            {authMode === "signup" ? t("auth.hasAccount") : t("auth.noAccount")}{" "}
            <button
              onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setAuthError(""); }}
              style={{ background:"transparent", border:"none", color:"#E8855D", fontWeight:700, cursor:"pointer" }}
            >
              {authMode === "signup" ? t("auth.login") : t("auth.signup")}
            </button>
          </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", maxWidth:430, margin:"0 auto", background:"#f5f4f0", fontFamily:"'Sora',sans-serif", display:"flex", flexDirection:"column", position:"relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
        input:focus,select:focus,textarea:focus{border-color:#5B8DD9!important;background:#fff!important;outline:none;}
        ::-webkit-scrollbar{display:none}
      `}</style>

      {/* 🔥 Sync Indicator */}
      {syncing && (
        <div style={{
          position:"fixed", top:10, right:10, zIndex:999,
          background:"rgba(45,43,38,.9)", color:"#fff", padding:"6px 12px",
          borderRadius:20, fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:6
        }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"#4CAF6E", animation:"pulse 1.5s infinite" }}/>
          {t("sync.saving")}
        </div>
      )}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* HEADER - compact mobile-first design */}
      <div style={{ position:"sticky", top:0, zIndex:100, background:"#1e1c18" }}>
        <div style={{ 
          background:"#1e1c18", color:"#fff", padding:"12px 16px", position:"relative", overflow:"hidden",
        }}>
          <div style={{ position:"absolute", top:-30, right:-20, width:80, height:80, borderRadius:"50%", background:"rgba(232,133,93,.15)" }}/>
          <div style={{ position:"relative", zIndex:1 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <h1 style={{ margin:0, fontSize:18, fontWeight:800, letterSpacing:"-.6px" }}>{t("app.name")}</h1>
                <span style={{ fontSize:10, opacity:.35 }}>{t("app.tagline")}</span>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <LanguageToggle size={26} />
                <button onClick={() => setShowStats(true)} style={{ width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none" }}>
                  <span style={{ fontSize:16, color:"rgba(255,255,255,.6)" }}>📈</span>
                </button>
                <button onClick={() => setShowAssetList(true)} style={{ width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none" }}>
                  <span style={{ fontSize:16, color:"rgba(255,255,255,.6)" }}>🏷️</span>
                </button>
                <button onClick={() => setShowCats(true)} style={{ width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none" }}>
                  <span style={{ fontSize:16, color:"rgba(255,255,255,.6)" }}>⚙</span>
                </button>
                <button onClick={handleSignOut} style={{ width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none" }}>
                  <span style={{ fontSize:16, color:"rgba(255,255,255,.6)" }}>⎋</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* Range selector - fuori dal padding principale */}
        <div style={{ marginTop:0, background:"#1e1c18", paddingBottom:8 }}>
          <RangeSelector active={range} onChange={r => { setRange(r); setExpandedId(null); }}/>
        </div>
        
        {/* Budget bar */}
        <div style={{ background:"#1e1c18" }}>
          <BudgetBar deadlines={deadlines} range={range} cats={cats}/>
        </div>
      </div>

      {/* TAB: Timeline / Scadute / Completate */}
      <div style={{ display:"flex", gap:0, background:"#fff", borderBottom:"1px solid #edecea", position:"sticky", top:0, zIndex:50 }}>
        {[
          { id:"timeline", labelKey:"tabs.timeline" }, 
          { id:"overdue", labelKey:"tabs.overdue" },
          { id:"done", labelKey:"tabs.done" }
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex:1, padding:"12px 0", border:"none", background:"transparent", cursor:"pointer",
            fontSize:14, fontWeight: activeTab === tab.id ? 700 : 500,
            color: activeTab === tab.id ? (tab.id === "overdue" ? "#E53935" : "#2d2b26") : "#8a877f",
            borderBottom: activeTab === tab.id ? `2.5px solid ${tab.id === "overdue" ? "#E53935" : "#2d2b26"}` : "2.5px solid transparent",
            transition:"all .2s", minHeight:44,
          }}>{t(tab.labelKey)}</button>
        ))}
      </div>

      {/* FILTRO SMART */}
      <CategoryFilter
        cats={cats}
        deadlines={deadlines}
        filterCat={filterCat}
        filterAsset={filterAsset}
        expandedCat={expandedFilterCat}
        onSelectCat={setFilterCat}
        onSelectAsset={setFilterAsset}
        onToggleExpand={setExpandedFilterCat}
        activeTab={activeTab}
        maxDays={maxDays}
        filterMandatory={filterMandatory}
        setFilterMandatory={setFilterMandatory}
        filterRecurring={filterRecurring}
        setFilterRecurring={setFilterRecurring}
        filterAutoPay={filterAutoPay}
        setFilterAutoPay={setFilterAutoPay}
        filterEssential={filterEssential}
        setFilterEssential={setFilterEssential}
        filterEstimateMissing={filterEstimateMissing}
        setFilterEstimateMissing={setFilterEstimateMissing}
      />

      {/* LISTA */}
      <div style={{ flex:1, overflowY:"auto", padding:"0 18px", paddingBottom:90 }}>
        {groups.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px", color:"#b5b2a8" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>{activeTab === "done" ? "🎉" : "📅"}</div>
            <div style={{ fontSize:15, fontWeight:600, color:"#8a877f" }}>{activeTab === "done" ? t("empty.doneTitle") : t("empty.timelineTitle")}</div>
            <div style={{ fontSize:13, marginTop:4 }}>{t("empty.hint")}</div>
          </div>
        ) : (
          groups.map(g => (
            <div key={g.key}>
              <GroupHeader group={g} cats={cats}/>
              {g.items.map(item => (
                <DeadlineCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => toggle(item.id)}
                  onComplete={() => complete(item.id)}
                  onSkip={() => skip(item.id)}
                  onDelete={() => del(item.id)}
                  onPostpone={() => postpone(item.id)}
                  onEdit={(item) => { setEditingDeadline(item); setShowAdd(true); }}
                  onUploadDoc={handleDocumentUpload}
                  onDeleteDoc={deleteDocument}
                  onViewDoc={setViewingDoc}
                  onAssetClick={(cat, asset) => setShowAsset({ cat, asset })}
                  cats={cats}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* FAB */}
      <button onClick={() => setShowAdd(true)} style={{
        position:"fixed", bottom:24, right: "calc(50% - 195px)", width:58, height:58, borderRadius:"50%",
        background:"#E8855D", border:"none", color:"#fff", fontSize:28, fontWeight:300,
        cursor:"pointer", boxShadow:"0 6px 24px rgba(232,133,93,.45)",
        display:"flex", alignItems:"center", justifyContent:"center", zIndex:60,
      }}>+</button>

      <AddSheet 
        open={showAdd || !!editingDeadline} 
        onClose={() => { 
          setShowAdd(false); 
          setEditingDeadline(null);
          setPresetAsset(null); 
        }} 
        onSave={add} 
        onUpdate={handleUpdateDeadline}
        cats={cats}
        presetAsset={presetAsset}
        editingItem={editingDeadline}
      />
      <StatsSheet open={showStats} onClose={() => setShowStats(false)} deadlines={deadlines} cats={cats}/>
      <AssetListSheet 
        open={showAssetList} 
        onClose={() => setShowAssetList(false)} 
        deadlines={deadlines} 
        cats={cats}
        onSelectAsset={(cat, asset) => setShowAsset({ cat, asset })}
      />
      {showAsset && (
        <AssetSheet 
          open={true} 
          onClose={() => setShowAsset(null)} 
          deadlines={deadlines} 
          cats={cats}
          catId={showAsset.cat}
          assetName={showAsset.asset}
          workLogs={workLogs}
          onAddWorkLog={(assetKey, work, editId) => {
            if (editId) {
              // Edit existing
              setWorkLogs(prev => ({
                ...prev,
                [assetKey]: (prev[assetKey] || []).map(w => w.id === editId ? work : w)
              }));
              showToast(t("toast.worklogUpdated"));
            } else {
              // Add new
              setWorkLogs(prev => ({
                ...prev,
                [assetKey]: [...(prev[assetKey] || []), work]
              }));
              showToast(t("toast.worklogAdded"));
            }
          }}
          onViewDoc={setViewingDoc}
        />
      )}
      <CategorySheet 
        open={showCats} 
        onClose={() => setShowCats(false)} 
        cats={cats} 
        onUpdateCats={setCats}
        deadlines={deadlines}
        workLogs={workLogs}
        onResetAll={resetCloudData}
      />
      
      {/* Payment Flow Modal */}
      <PaymentFlowModal
        open={paymentFlow !== null}
        item={paymentFlow ? deadlines.find(d => d.id === paymentFlow.itemId) : null}
        onConfirm={confirmPayment}
        onClose={() => { setPaymentFlow(null); setPaymentAmount(""); setDownpaymentDate(""); }}
        step={paymentFlow?.step || 'choose'}
        amount={paymentAmount}
        setAmount={setPaymentAmount}
        downpaymentDate={downpaymentDate}
        setDownpaymentDate={setDownpaymentDate}
        onChangeStep={(newStep) => setPaymentFlow(prev => ({ ...prev, step: newStep }))}
      />

      {/* Postpone modal */}
      {postponeId && (
        <div onClick={e => e.target === e.currentTarget && setPostponeId(null)} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:200,
          display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)",
        }}>
          <div style={{
            background:"#fff", borderRadius:18, padding:"20px 22px", width:"85%", maxWidth:340,
            animation:"popIn .22s cubic-bezier(.34,1.56,.64,1) both",
          }}>
            <style>{`@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
            <h3 style={{ margin:"0 0 14px", fontSize:17, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{t("postpone.title")}</h3>
            <p style={{ margin:"0 0 16px", fontSize:13, color:"#6b6961" }}>{t("postpone.subtitle")}</p>
            <input
              type="date"
              value={postponeDate}
              onChange={e => setPostponeDate(e.target.value)}
              style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #edecea", fontSize:14, outline:"none", marginBottom:16 }}
              autoFocus
            />
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setPostponeId(null)} style={{ flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>{t("actions.cancel")}</button>
              <button onClick={confirmPostpone} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#FB8C00", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 }}>{t("actions.confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Recurring Scope Modal */}
      {editConfirm && (
        <div onClick={() => setEditConfirm(null)} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:200,
          display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#fff", borderRadius:18, padding:"20px 22px", width:"85%", maxWidth:380,
            animation:"popIn .22s cubic-bezier(.34,1.56,.64,1) both",
          }}>
            <style>{`@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
            <h3 style={{ margin:"0 0 10px", fontSize:17, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>
              {t("editRecurring.title")}
            </h3>
            <p style={{ margin:"0 0 10px", fontSize:13, color:"#6b6961" }}>
              {t("editRecurring.subtitle")}
            </p>
            {editScheduleChanged && (
              <p style={{ margin:"0 0 14px", fontSize:12, color:"#E53935", fontWeight:600 }}>
                {t("editRecurring.warning")}
              </p>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <button onClick={() => applyEditScope("single")} style={{ padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, color:"#2d2b26" }}>
                {t("editRecurring.onlyThis")}
              </button>
              <button onClick={() => applyEditScope("future")} style={{ padding:"12px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 }}>
                {t("editRecurring.fromThis")}
              </button>
              <button onClick={() => applyEditScope("all")} style={{ padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, color:"#6b6961" }}>
                {t("editRecurring.all")}
              </button>
            </div>
            <button onClick={() => setEditConfirm(null)} style={{ marginTop:12, width:"100%", padding:"10px", borderRadius:10, border:"none", background:"#edecea", color:"#6b6961", fontSize:13, fontWeight:600, cursor:"pointer" }}>
              {t("actions.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div onClick={() => setDeleteConfirm(null)} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:200,
          display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#fff", borderRadius:18, padding:"20px 22px", width:"85%", maxWidth:380,
            animation:"popIn .22s cubic-bezier(.34,1.56,.64,1) both",
          }}>
            <style>{`@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
            <h3 style={{ margin:"0 0 14px", fontSize:17, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>
              {t("deleteSeries.title")}
            </h3>
            <p style={{ margin:"0 0 8px", fontSize:14, color:"#2d2b26", lineHeight:1.5 }}>
              {t("deleteSeries.subtitle", { current: deleteConfirm.recurringIndex, total: deleteConfirm.recurringTotal })}
            </p>
            <p style={{ margin:"0 0 16px", fontSize:14, color:"#2d2b26", fontWeight:600, lineHeight:1.5 }}>
              {t("deleteSeries.warning", { count: deleteConfirm.futureCount - 1 })}
            </p>
            <p style={{ margin:"0 0 20px", fontSize:12, color:"#8a877f", fontStyle:"italic" }}>
              {t("deleteSeries.note")}
            </p>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ 
                flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", 
                cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961", minHeight:44 
              }}>{t("actions.cancel")}</button>
              <button onClick={confirmDelete} style={{ 
                flex:1, padding:"12px", borderRadius:12, border:"none", background:"#E53935", 
                color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, minHeight:44 
              }}>{t("deleteSeries.confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Document Lightbox */}
      {viewingDoc && (
        <div onClick={() => setViewingDoc(null)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,.92)", zIndex:300,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:20,
        }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#fff", marginBottom:16, maxWidth:"90%", textAlign:"center" }}>{viewingDoc.filename}</div>
          <img src={viewingDoc.base64} style={{ maxWidth:"100%", maxHeight:"70vh", borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,.5)" }} alt="Document" />
          <div style={{ display:"flex", gap:10, marginTop:18, flexWrap:"wrap", justifyContent:"center" }}>
            <a
              href={viewingDoc.base64}
              target="_blank"
              rel="noreferrer"
              style={{ padding:"12px 18px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", fontSize:13, fontWeight:700, textDecoration:"none", cursor:"pointer" }}
              onClick={e => e.stopPropagation()}
            >
              {t("actions.open")}
            </a>
            <a
              href={viewingDoc.base64}
              download={viewingDoc.filename || "documento"}
              style={{ padding:"12px 18px", borderRadius:12, border:"2px solid #fff", background:"transparent", color:"#fff", fontSize:13, fontWeight:700, textDecoration:"none", cursor:"pointer" }}
              onClick={e => e.stopPropagation()}
            >
              {t("actions.download")}
            </a>
            <button
              onClick={(e) => { e.stopPropagation(); shareDocument(viewingDoc); }}
              style={{ padding:"12px 18px", borderRadius:12, border:"none", background:"#5B8DD9", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}
            >
              {t("actions.share")}
            </button>
            <button onClick={() => setViewingDoc(null)} style={{ padding:"12px 18px", borderRadius:12, border:"none", background:"#fff", color:"#2d2b26", fontSize:13, fontWeight:700, cursor:"pointer" }}>{t("actions.close")}</button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position:"fixed", bottom:90, left:"50%", transform:"translateX(-50%)",
          background:"rgba(45,43,38,.95)", color:"#fff", borderRadius:12,
          padding:"12px 18px", fontSize:13, fontWeight:600, maxWidth:"85%",
          boxShadow:"0 8px 24px rgba(0,0,0,.3)", zIndex:100,
          animation:"toastIn .3s ease both",
        }}>
          <style>{`@keyframes toastIn{from{transform:translateX(-50%) translateY(20px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}`}</style>
          {toast}
        </div>
      )}
    </div>
  );
}
