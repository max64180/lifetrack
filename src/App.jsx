import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, writeBatch, query, where, orderBy } from 'firebase/firestore/lite';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { DEFAULT_CATS, RANGES } from "./data/constants";
import { getCat } from "./utils/cats";
import { compressImage, compressImageToBlob, fileToBase64 } from "./utils/files";
import { computeOccurrences, getAutoEndDate, getOccurrenceDate } from "./utils/recurrence";
import PriorityFilter from "./components/PriorityFilter";
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
const storage = getStorage(app);

const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const APP_BUILD_TIME = typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : "";
const POLL_BASE_MS = 20 * 60 * 1000;
const POLL_MAX_MS = 90 * 60 * 1000;
const MIN_POLL_GAP_MS = 10 * 60 * 1000;
const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;
const FULL_SYNC_EVERY_MS = 24 * 60 * 60 * 1000;
const SYNC_POLL_ENABLED = false;
const FOCUS_SYNC_GAP_MS = 2 * 60 * 60 * 1000;
const RANGE_IDS = new Set(RANGES.map(r => r.id));
const getSafeRange = (value) => (RANGE_IDS.has(value) ? value : "mese");
const MAX_ATTACHMENTS = 3;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 20000;
const USE_STORAGE = false;




/* ── CONFIG & DATI ─────────────────────────────────────── */
// Format currency without decimals (fix #1)
const formatCurrency = (amount) => `€${Math.round(amount)}`;
const formatNumber = (amount) => Math.round(amount).toLocaleString(getLocale());

const TODAY = new Date(); TODAY.setHours(0,0,0,0);
function addDays(n) { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; }
function addMonths(date, months) { const d = new Date(date); d.setMonth(d.getMonth() + months); return d; }
const PET_CAT = { id:"pet", label:"Pet", icon:"🐾", color:"#7B8BE8", light:"#EEF0FF" };

/* ── DATI FAKE RIMOSSI - App vuota per uso reale ──────────────────────────────────── */


/* ── TIME RANGES ───────────────────────────────────────── */

/* ── GROUPING LOGIC ────────────────────────────────────── */
function getGroupKey(date, range) {
  const y = date.getFullYear();
  const m = date.getMonth();
  if (range === "settimana" || range === "mese") {
    const key = date.toISOString().split("T")[0];
    const label = capitalize(date.toLocaleDateString(getLocale(), { weekday:"short", day:"2-digit", month:"short" }));
    return { key, label, order: date.getTime() };
  }
  // trimestre / semestre / anno → raggruppa per mese
  return { key: `${y}-${m}`, label: `${capitalize(date.toLocaleDateString(getLocale(), { month:"long" }))} ${y}`, order: y * 12 + m };
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

/* ── PERIOD RANGE ───────────────────────────────────────── */
function getPeriodRange(range, offset = 0) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  if (range === "settimana") {
    const day = (base.getDay() + 6) % 7; // Monday = 0
    const start = new Date(base);
    start.setDate(base.getDate() - day + offset * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (range === "mese") {
    const target = new Date(base);
    target.setMonth(target.getMonth() + offset);
    const year = target.getFullYear();
    const month = target.getMonth();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { start, end, year, month };
  }

  if (range === "trimestre") {
    const baseQuarter = Math.floor(base.getMonth() / 3);
    const totalQuarter = base.getFullYear() * 4 + baseQuarter + offset;
    const year = Math.floor(totalQuarter / 4);
    const quarter = totalQuarter - year * 4;
    const startMonth = quarter * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
    return { start, end, year, quarter };
  }

  if (range === "semestre") {
    const baseHalf = base.getMonth() < 6 ? 0 : 1;
    const totalHalf = base.getFullYear() * 2 + baseHalf + offset;
    const year = Math.floor(totalHalf / 2);
    const half = totalHalf - year * 2;
    const startMonth = half * 6;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 6, 0, 23, 59, 59, 999);
    return { start, end, year, half };
  }

  // anno
  const year = base.getFullYear() + offset;
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  return { start, end, year };
}

/* ── HELPERS ───────────────────────────────────────────── */
const getLocale = () => (i18n.language || "it").toLowerCase().startsWith("it") ? "it-IT" : "en-US";
const capitalize = (value) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

function diffDays(d) { return Math.round((d - TODAY) / 86400000); }
function fmtDate(d) { return d.toLocaleDateString(getLocale(), { day:"2-digit", month:"short" }); }


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

function normalizeAssetDocs(raw = {}) {
  const parsed = {};
  Object.keys(raw || {}).forEach(key => {
    if (Array.isArray(raw[key])) parsed[key] = raw[key];
  });
  return parsed;
}

const sanitizeFilename = (name = "file") =>
  name.replace(/[^\w.\-]+/g, "_").slice(0, 80);

const isImageType = (type = "") => type.startsWith("image/");

function deadlineForCompare(raw) {
  if (!raw) return raw;
  const { updatedAt, ...rest } = raw;
  const date = rest.date instanceof Date ? rest.date.toISOString() : rest.date;
  return { ...rest, date };
}

function isSameDeadline(a, b) {
  if (!a || !b) return false;
  try {
    return JSON.stringify(deadlineForCompare(a)) === JSON.stringify(deadlineForCompare(b));
  } catch (err) {
    return false;
  }
}

function stripUndefined(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(stripUndefined).filter(v => v !== undefined);
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      const cleaned = stripUndefined(v);
      if (cleaned !== undefined) out[k] = cleaned;
    });
    return out;
  }
  return value;
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
function RangeSelector({ active, onChange, tone = "dark", compact = false, padding = "0 18px" }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const isCompact = RANGES.length <= 2 || compact;
  const inactiveBg = tone === "dark" ? "rgba(255,255,255,.12)" : "#f2f1ed";
  const inactiveColor = tone === "dark" ? "rgba(255,255,255,.55)" : "#7b7871";
  const activeBg = "#2d2b26";
  const activeColor = "#fff";
  const buttonPadding = isCompact ? "6px 14px" : "8px 18px";
  const buttonFont = isCompact ? 12 : 13;
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-active="true"]`);
    el?.scrollIntoView({ inline:"center", behavior:"smooth", block:"nearest" });
  }, [active]);

  return (
    <div ref={ref} style={{
      display:"flex", gap:8, padding, justifyContent: isCompact ? "center" : "flex-start",
      overflowX: isCompact ? "visible" : "auto",
      scrollbarWidth:"none", WebkitOverflowScrolling:"touch", scrollSnapType: isCompact ? "none" : "x mandatory",
      touchAction: isCompact ? "auto" : "pan-x", // only allow horizontal scroll when needed
    }}>
      <style>{`::-webkit-scrollbar{display:none}`}</style>
      {RANGES.map(r => {
        const isActive = r.id === active;
        return (
          <button key={r.id} data-active={isActive} onClick={() => onChange(r.id)} style={{
            flexShrink:0, scrollSnapAlign:"center",
            padding: buttonPadding, borderRadius:22, border:"none", cursor:"pointer",
            background: isActive ? activeBg : inactiveBg,
            color: isActive ? activeColor : inactiveColor,
            fontSize: buttonFont, fontWeight:700, fontFamily:"'Sora',sans-serif",
            transition:"background .2s, color .2s, transform .15s",
            transform: isActive ? "scale(1.04)" : "scale(1)",
            boxShadow: isActive ? "0 3px 12px rgba(0,0,0,.15)" : "none",
          }}>{t(r.labelKey, { defaultValue: r.label })}</button>
        );
      })}
    </div>
  );
}

/* Budget summary bar */
function BudgetBar({ deadlines, periodStart, periodEnd, cats, activeTab }) {
  const { t } = useTranslation();
  const inRange = deadlines.filter(d => !d.done && d.date >= periodStart && d.date <= periodEnd);
  const tabFiltered = (() => {
    if (activeTab === "done") return deadlines.filter(d => d.done && !d.skipped);
    if (activeTab === "overdue") return deadlines.filter(d => d.date < TODAY && !d.done);
    return inRange;
  })();
  const inRangeBudgeted = tabFiltered.filter(d => !d.estimateMissing);
  const total   = inRangeBudgeted.reduce((s, d) => s + d.budget, 0);
  const count   = tabFiltered.length;
  const missingCount = tabFiltered.filter(d => d.estimateMissing).length;
  const urgent  = tabFiltered.filter(d => diffDays(d.date) <= 7).length;
  const mandatoryCount = tabFiltered.filter(d => d.mandatory).length;
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1, 0, 0, 0, 0);
  const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999);
  const yearTotal = deadlines
    .filter(d => d.date >= yearStart && d.date <= yearEnd && !d.estimateMissing)
    .reduce((s, d) => s + d.budget, 0);

  const yearCount = deadlines.filter(d => d.date >= yearStart && d.date <= yearEnd).length;

  return (
    <div style={{ padding:"8px 14px 0" }}>
      <div style={{ background:"rgba(255,255,255,.08)", borderRadius:16, padding:"10px 12px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", gap:12 }}>
          <div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,.45)", fontWeight:800, textTransform:"uppercase", letterSpacing:".6px" }}>
              {t("budgetBar.periodSelected", { defaultValue: "Periodo selezionato" })}
            </div>
            <div style={{ fontSize:28, fontWeight:900, color:"#fff", letterSpacing:"-1px", marginTop:2, fontFamily:"'Sora',sans-serif" }}>
              {formatCurrency(total)}
              <span style={{ fontSize:13, fontWeight:800, color:"rgba(255,255,255,.7)", marginLeft:8 }}>
                · {t("budgetBar.deadlinesCount", { count, defaultValue: `${count} scadenze` })}
              </span>
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,.35)", fontWeight:800, textTransform:"uppercase", letterSpacing:".6px" }}>
              {t("budgetBar.yearTotal", { year: currentYear, defaultValue: `Budget previsto ${currentYear}` })}
            </div>
            <div style={{ fontSize:17, fontWeight:600, color:"rgba(255,255,255,.75)", marginTop:2 }}>
              {formatCurrency(yearTotal)}
            </div>
            <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,.45)", marginTop:2 }}>
              {t("budgetBar.deadlinesCount", { count: yearCount, defaultValue: `${yearCount} scadenze` })}
            </div>
          </div>
        </div>

        <div style={{ height:1, background:"rgba(255,255,255,.08)", margin:"8px 0 10px" }} />

        <div style={{ display:"flex", height:4, borderRadius:3, overflow:"hidden", background:"rgba(255,255,255,.08)" }}>
          <div style={{ width:"100%", background:"#E8855D" }}/>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap", minHeight:20, alignItems:"center" }}>
          {urgent > 0 && (
            <div style={{ background:"rgba(232,133,93,.25)", borderRadius:999, padding:"3px 6px", display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ fontSize:10 }}>⚡</span>
              <span style={{ fontSize:10, fontWeight:800, color:"#E8855D" }}>
                {t("budgetBar.urgent", { count: urgent, defaultValue: `Urgenti ${urgent}` })}
              </span>
            </div>
          )}
          {mandatoryCount > 0 && (
            <div style={{ background:"rgba(229,57,53,.12)", borderRadius:999, padding:"3px 6px", display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ fontSize:10 }}>⚠️</span>
              <span style={{ fontSize:10, fontWeight:800, color:"#E53935" }}>
                {t("budgetBar.mandatory", { count: mandatoryCount, defaultValue: `Inderogabili ${mandatoryCount}` })}
              </span>
            </div>
          )}
          {missingCount > 0 && (
            <div style={{ background:"rgba(255,248,237,.2)", borderRadius:999, padding:"3px 6px", display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ fontSize:10 }}>❔</span>
              <span style={{ fontSize:10, fontWeight:800, color:"#E6C97A" }}>
                {t("budgetBar.missing", { count: missingCount, defaultValue: `Da stimare ${missingCount}` })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function YearDetailRow({ item, cats }) {
  const { t } = useTranslation();
  const cat = item.petId ? PET_CAT : (getCat(cats, item.cat) || {});
  const amountText = item.estimateMissing ? "—" : formatCurrency(item.budget || 0);
  const amountColor = item.estimateMissing ? "#8a6d1f" : "#E8855D";
  const subParts = [cat.label, item.asset, fmtDate(item.date)].filter(Boolean);

  return (
    <div style={{
      background:"#fff", borderRadius:14, border:"1px solid #edecea",
      padding:"10px 12px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
        <div style={{
          width:38, height:38, borderRadius:12,
          background: cat.light || "#f5f4f0", display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:18
        }}>
          {cat.icon || "📌"}
        </div>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:800, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {item.title}
          </div>
          <div style={{ fontSize:11, color:"#8a877f", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {subParts.join(" · ")}
          </div>
        </div>
      </div>
      <div style={{ textAlign:"right", minWidth:60 }}>
        <div style={{ fontSize:13, fontWeight:800, color: amountColor }}>{amountText}</div>
        {item.mandatory && (
          <div style={{ fontSize:9, fontWeight:700, color:"#E53935", textTransform:"uppercase", letterSpacing:".3px" }}>
            {t("card.mandatory")}
          </div>
        )}
        {item.estimateMissing && !item.mandatory && (
          <div style={{ fontSize:9, fontWeight:700, color:"#8a6d1f", textTransform:"uppercase", letterSpacing:".3px" }}>
            {t("card.estimateMissing")}
          </div>
        )}
        {item.skipped && (
          <div style={{ fontSize:9, fontWeight:700, color:"#6b6961", textTransform:"uppercase", letterSpacing:".3px" }}>
            {t("card.skipped")}
          </div>
        )}
      </div>
    </div>
  );
}

/* Carta scadenza – ICONE PIÙ GRANDI E VISIVE */
function DeadlineCard({ item, expanded, onToggle, onComplete, onDelete, onPostpone, onEdit, onSkip, onUploadDoc, onDeleteDoc, onViewDoc, onAssetClick, cats }) {
  const { t } = useTranslation();
  const cat = item.petId ? PET_CAT : getCat(cats, item.cat);
  const days = diffDays(item.date);
  const isPet = !!item.petId;
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
  const rightTags = [
    item.autoPay ? { icon:"↺", label:"Auto", bg:"#EBF2FC", color:"#5B8DD9", key:"auto" } : null,
    item.recurring?.enabled ? { icon:"🔁", label:"Ric", bg:"#EBF2FC", color:"#5B8DD9", key:"ric" } : null,
  ].filter(Boolean);
  const statusBadge = item.mandatory ? "mandatory" : (item.essential ? "essential" : "");

  return (
    <div style={{ marginBottom:8 }}>
      <div
        onClick={() => onToggle(item.id)}
        style={{
          display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
          background:"#fff", borderRadius: expanded ? "14px 14px 0 0" : 14,
          border:`1px solid ${expanded ? cat.color : "#edecea"}`,
          borderBottom: expanded ? "none" : undefined,
          cursor:"pointer", transition:"border-color .2s", WebkitTapHighlightColor:"transparent", minHeight:52,
        }}
      >
        <div style={{
          width:26, height:26, borderRadius:8, flexShrink:0,
          background: item.done ? "#f0efe8" : cat.light,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:14,
          border: `1px solid ${item.done ? "#e0ddd6" : cat.color + "33"}`,
        }}>
          {item.done ? "✓" : cat.icon}
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:14, fontWeight:700, color: item.done ? "#999" : "#2d2b26", textDecoration: item.done ? "line-through" : "none", fontFamily:"'Sora',sans-serif", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {statusBadge === "mandatory" && <span style={{ fontSize:13, marginRight:2 }}>⚠️</span>}
            {statusBadge === "essential" && (
              <span style={{ width:8, height:8, borderRadius:"50%", background:"#4CAF6E", display:"inline-block", marginRight:4 }} />
            )}
            <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{item.title}</span>
          </div>
          {(item.asset || rightTags.length > 0) && (
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2, minWidth:0 }}>
              {item.asset && (
                <span style={{ fontSize:11, color:"#8a877f", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:"1 1 auto" }}>
                  {item.asset}
                </span>
              )}
              <div style={{ display:"flex", gap:4, flexWrap:"nowrap", flex:"0 0 auto", marginLeft:"auto", justifyContent:"flex-end", minWidth:120 }}>
                {["auto","ric"].map((key) => {
                  const tag = rightTags.find(t => t.key === key);
                  return (
                    <span key={key} style={{
                      fontSize:10, fontWeight:700,
                      color: tag ? tag.color : "transparent",
                      background: tag ? tag.bg : "transparent",
                      borderRadius:999, padding:"2px 6px", display:"inline-flex", alignItems:"center", gap:4,
                      border: tag ? `1px solid ${tag.color}33` : "1px solid transparent",
                      visibility: tag ? "visible" : "hidden"
                    }}>
                      <span style={{ fontSize:11 }}>{tag ? tag.icon : "•"}</span>
                      {tag ? tag.label : "—"}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0, minWidth:52 }}>
          {item.estimateMissing ? (
            <span style={{ fontSize:11, fontWeight:700, color:"#8a6d1f" }}>{t("card.estimateMissing")}</span>
          ) : (
            item.skipped
              ? <span style={{ fontSize:12, fontWeight:800, color:"#6b6961", textDecoration:"line-through" }}>€0</span>
              : item.budget > 0 && <span style={{ fontSize:12, fontWeight:800, color:cat.color }}>{formatCurrency(item.budget)}</span>
          )}
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

          {item.skipped && (
            <div style={{ fontSize:11, color:"#6b6961", background:"#f0efe8", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              {t("card.skipped")}
            </div>
          )}

          {!isPet && item.estimateMissing && !item.done && (
            <div style={{ fontSize:11, color:"#8a6d1f", background:"#FFF8ED", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <span>{t("card.estimateMissingTitle")}</span>
              <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"#2d2b26", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                {t("card.addEstimate")}
              </button>
            </div>
          )}

          {/* Documents section */}
          {!isPet && ((item.documents && item.documents.length > 0) || !item.done) && (
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
                  <input type="file" accept="image/*,application/pdf,*/*" style={{ display:"none" }} onChange={(e) => { if(e.target.files[0]) onUploadDoc(item.id, 'incoming', e.target.files[0]); e.target.value=''; }} />
                  {t("docs.attachDocument")}
                </label>
              )}
              {item.done && (
                <label style={{ display:"block", padding:"7px", borderRadius:8, border:"1px dashed #4CAF6E44", background:"#E8F5E9", color:"#4CAF6E", fontSize:11, fontWeight:600, cursor:"pointer", textAlign:"center", minHeight:32 }}>
                  <input type="file" accept="image/*,application/pdf,*/*" style={{ display:"none" }} onChange={(e) => { if(e.target.files[0]) onUploadDoc(item.id, 'receipt', e.target.files[0]); e.target.value=''; }} />
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

          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {/* Se è scaduta, offri "Posticipa" */}
            {days < 0 && !item.done && (
              <button onClick={(e) => { e.stopPropagation(); onPostpone(item.id); }} style={{
                flex:"1 1 48%", minWidth:0, padding:"11px", borderRadius:10, border:"none",
                background:"#FB8C00", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
              }}>↻ {t("actions.postpone")}</button>
            )}

            {item.recurring && item.recurring.enabled && !item.done && (
              <button onClick={(e) => { e.stopPropagation(); onSkip(item.id); }} style={{
                flex:"1 1 48%", minWidth:0, padding:"11px", borderRadius:10, border:"none",
                background:"#edecea", color:"#6b6961", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
              }}>⏭ {t("actions.skip")}</button>
            )}
            
            <button onClick={(e) => { e.stopPropagation(); onComplete(item.id); }} style={{
              flex:"1 1 48%", minWidth:0, padding:"11px", borderRadius:10, border:"none",
              background: item.done ? "#edecea" : cat.color,
              color: item.done ? "#6b6961" : "#fff",
              fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>{item.done ? `↩ ${t("actions.reactivate")}` : `✓ ${t("actions.complete")}`}</button>
            
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} style={{
              flex:"1 1 48%", minWidth:0, padding:"11px", borderRadius:10, border:"none",
              background:"#FFF0EC", color:"#E53935", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>{t("actions.delete")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Smart Category Filter with asset sub-filters */
/* Group header */
function GroupHeader({ group, cats }) {
  const total = group.items.filter(d => !d.done && !d.estimateMissing).reduce((s, d) => s + d.budget, 0);
  const activeCount = group.items.filter(d => !d.done).length;
  const doneCount = group.items.filter(d => d.done).length;

  const catMap = {};
  group.items.filter(d => !d.done && !d.estimateMissing).forEach(d => { catMap[d.cat] = (catMap[d.cat] || 0) + d.budget; });
  const catEntries = Object.entries(catMap).sort((a,b) => b[1] - a[1]);

  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 0 6px", position:"relative" }}>
      <div style={{
        position:"absolute", left:-20, top:18, width:10, height:10, borderRadius:"50%",
        background:"#E8855D", boxShadow:"0 0 0 3px #f5f4f0"
      }}/>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{group.label}</div>
        <div style={{ fontSize:11, color:"#8a877f", marginTop:1 }}>
          {activeCount} attiv{activeCount !== 1 ? "e" : "a"}{doneCount > 0 ? ` · ${doneCount} completat${doneCount !== 1 ? "e" : "a"}` : ""}
        </div>
      </div>
      <div style={{ textAlign:"right" }}>
        {catEntries.length > 0 && (
          <div style={{ display:"flex", gap:2, marginTop:4, justifyContent:"flex-end" }}>
            {catEntries.map(([catId, amt]) => {
              const c = catId === "pet" ? PET_CAT : getCat(cats, catId);
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
              style={{ ...dateInpModal, marginBottom:20 }}
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

function AddSheet({ open, onClose, onSave, onUpdate, cats, presetAsset, editingItem, onToast }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState({ 
    title:"", cat:"", asset:null, date:"", budget:"", notes:"", 
    mandatory:false, essential:true, autoPay:false, documents:[],
    recurringEnabled: false,
    recurringInterval: 1,
    recurringUnit: "mesi",
    recurringCount: 12,
    recurringPreset: "mensile", // mensile | trimestrale | annuale | custom
    recurringEndMode: "auto", // auto | count | date
    recurringEndDate: ""
  });
  const [mode, setMode] = useState("one"); // one | recurring
  const stepCardSize = "min(70vw, 240px)";

  useEffect(() => { 
    if (!open) {
      setStep(0);
      setShowAdvanced(false);
      setMode("one");
      setForm({ 
        title:"", cat:"", asset:null, date:"", budget:"", notes:"", 
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
      setMode(editingItem.recurring?.enabled ? "recurring" : "one");
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
  const toggleMandatory = () => {
    setForm(f => {
      const next = !f.mandatory;
      return { ...f, mandatory: next, essential: next ? true : f.essential };
    });
  };
  const toggleEssential = () => {
    setForm(f => {
      const next = !f.essential;
      return { ...f, essential: next, mandatory: next ? f.mandatory : false };
    });
  };
  const selectedCat = cats.find(c => c.id === form.cat) || null;
  const hasAssets = !!(selectedCat && selectedCat.assets && selectedCat.assets.length > 0);
  const steps = [
    t("wizard.step.type", { defaultValue: "Tipo" }),
    t("wizard.step.details", { defaultValue: "Dati" }),
    t("wizard.step.document", { defaultValue: "Documento" })
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
  const unitLabel = (unit, count) => {
    const map = unitMap[unit] || unitMap.mesi;
    return count === 1 ? map[lang][0] : map[lang][1];
  };
  const recurringLabel = (() => {
    if (!form.recurringEnabled) return t("recurring.none", { defaultValue: "Nessuna" });
    const countSafe = Math.max(1, parseInt(form.recurringInterval) || 1);
    return lang === "it"
      ? `Ogni ${countSafe} ${unitLabel(form.recurringUnit, countSafe)}`
      : `Every ${countSafe} ${unitLabel(form.recurringUnit, countSafe)}`;
  })();

  const canProceedDetails = form.title.trim() && form.date && form.cat;
  const disableNext = step === 1 && !canProceedDetails;

  const toggleMode = (next) => {
    setMode(next);
    if (next === "recurring") {
      set("recurringEnabled", true);
    } else {
      set("recurringEnabled", false);
      set("autoPay", false);
    }
  };

  const finalize = () => {
    if (!form.title || !form.date || !form.cat) return;
    if (editingItem) {
      onUpdate(form);
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
          title: form.title,
          cat: form.cat,
          asset: form.asset,
          budget: baseAmount,
          estimateMissing: budgetMissing,
          notes: form.notes,
          mandatory: form.mandatory,
          essential: form.mandatory ? true : form.essential,
          autoPay: form.recurringEnabled ? form.autoPay : false,
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
      onSave(newSeries);
    } else {
      const newDate = new Date(form.date + "T00:00:00");
      onSave({
        id: Date.now(),
        title: form.title,
        cat: form.cat,
        asset: form.asset,
        budget: baseAmount,
        estimateMissing: budgetMissing,
        notes: form.notes,
        mandatory: form.mandatory,
        essential: form.mandatory ? true : form.essential,
        autoPay: form.recurringEnabled ? form.autoPay : false,
        date: newDate,
        documents: form.documents,
        recurring: null,
        done: false
      });
    }
    onClose();
  };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position:"fixed", inset:0, background:"#f6f2ed", zIndex:200,
      display:"flex", alignItems:"stretch", justifyContent:"center"
    }}>
      <div style={{
        width:"100%", maxWidth:480, color:"#2d2b26", padding:"20px 18px 28px",
        display:"flex", flexDirection:"column", gap:16, overflowY:"auto"
      }}>
        <div style={{ marginTop:6 }}>
          <div style={{ fontSize:22, fontWeight:800, letterSpacing:"-.3px" }}>{editingItem ? t("wizard.editTitle") : t("wizard.newTitle")}</div>
          <div style={{ fontSize:13, color:"#8f8a83", marginTop:4 }}>{t("wizard.quickHint", { defaultValue: "Configura in 30 secondi" })}</div>
        </div>

        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <div style={{ flex:1, height:6, borderRadius:6, background:"#e2ddd6" }}>
            <div style={{ width:`${((step+1)/steps.length)*100}%`, height:"100%", borderRadius:6, background:"#E8855D" }}/>
          </div>
          <div style={{ fontSize:12, color:"#8f8a83", fontWeight:700 }}>{`Step ${step+1} di ${steps.length} · ${steps[step]}`}</div>
        </div>
        <style>{`
          .wizard-field-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:start;align-content:start;grid-auto-rows:min-content}
          .wizard-field-col{min-width:0}
          .wizard-field-col input{max-width:100%;box-sizing:border-box;display:block;width:100%}
          .wizard-date-wrap{position:relative;overflow:hidden}
          .wizard-date-input{-webkit-appearance:none;appearance:none;padding-right:42px!important}
          .wizard-date-input::-webkit-calendar-picker-indicator{opacity:0;width:0;margin:0;padding:0}
          .wizard-date-icon{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:13px;color:#8f8a83;pointer-events:none;line-height:1}
          @media (max-width: 420px){
            .wizard-field-row{grid-template-columns:1fr}
          }
        `}</style>

        {step == 0 && (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ display:"flex", flexDirection:"column", gap:18, alignItems:"center" }}>
              <div onClick={() => toggleMode("one")} style={{
                width: stepCardSize, height: stepCardSize,
                background: mode === "one" ? "#fff" : "#f4f1ec",
                color: mode === "one" ? "#2d2b26" : "#6d6760",
                borderRadius:20, padding:"18px 16px", cursor:"pointer",
                border: mode === "one" ? "2px solid #E8855D" : "2px dashed #d4cfc8",
                display:"flex", flexDirection:"column", justifyContent:"center", textAlign:"center", gap:8
              }}>
                <div style={{ fontSize:19, fontWeight:800 }}>{t("wizard.oneTime", { defaultValue: "Una tantum" })}</div>
                <div style={{ fontSize:13, opacity:.7 }}>{t("wizard.oneTimeHint", { defaultValue: "Titolo + data, veloce" })}</div>
              </div>
              <div onClick={() => toggleMode("recurring")} style={{
                width: stepCardSize, height: stepCardSize,
                background: mode === "recurring" ? "#fff" : "#f4f1ec",
                color: mode === "recurring" ? "#2d2b26" : "#6d6760",
                borderRadius:20, padding:"18px 16px", cursor:"pointer",
                border: mode === "recurring" ? "2px solid #E8855D" : "2px dashed #d4cfc8",
                display:"flex", flexDirection:"column", justifyContent:"center", textAlign:"center", gap:8
              }}>
                <div style={{ fontSize:19, fontWeight:800 }}>{t("wizard.recurring", { defaultValue: "Ricorrente (bollette)" })}</div>
                <div style={{ fontSize:13, color:"#8f8a83" }}>{t("wizard.recurringHint", { defaultValue: "Ogni mese senza dimenticare" })}</div>
              </div>
            </div>
          </div>
        )}

        {step == 1 && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <label style={{ fontSize:11, fontWeight:800, color:"#8f8a83", textTransform:"uppercase" }}>{t("wizard.title")}</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} placeholder={t("wizard.titlePlaceholder")} style={{ width:"100%", padding:"12px 14px", borderRadius:14, border:"1px solid #e2ddd6", background:"#fff", color:"#2d2b26", fontSize:16 }} />

            <div className="wizard-field-row">
              <div className="wizard-field-col">
                <label style={{ fontSize:11, fontWeight:800, color:"#8f8a83", textTransform:"uppercase" }}>{mode === "recurring" ? t("wizard.dayOfMonth", { defaultValue: "Giorno" }) : t("wizard.dueDate", { defaultValue: "Data scadenza" })}</label>
                <div className="wizard-date-wrap">
                  <input className="wizard-date-input" type="date" value={form.date} onChange={e => set("date", e.target.value)} style={{ width:"100%", minWidth:0, padding:"12px 42px 12px 14px", borderRadius:14, border:"1px solid #e2ddd6", background:"#fff", color:"#2d2b26", fontSize:16 }} />
                  <span className="wizard-date-icon">📅</span>
                </div>
              </div>
              <div className="wizard-field-col">
                <label style={{ fontSize:11, fontWeight:800, color:"#8f8a83", textTransform:"uppercase" }}>{t("wizard.budget")}</label>
                <input type="number" value={form.budget} onChange={e => set("budget", e.target.value)} placeholder={t("wizard.budgetPlaceholder", { defaultValue: "Opzionale" })} style={{ width:"100%", minWidth:0, padding:"12px 14px", borderRadius:14, border:"1px solid #e2ddd6", background:"#fff", color:"#2d2b26", fontSize:16 }} />
              </div>
            </div>

            <div style={{ display:"flex", gap:6, flexWrap:"nowrap", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
              <button type="button" onClick={toggleMandatory} style={{ padding:"7px 10px", borderRadius:999, border:"1px solid #e2ddd6", background: form.mandatory ? "#FFF0EC" : "#f4f1ec", color: form.mandatory ? "#E53935" : "#6d6760", fontSize:12, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:12, color:"#E8855D" }}>⚠️</span>{t("wizard.mandatoryShort", { defaultValue: "Inderogabile" })}
              </button>
              <button type="button" onClick={toggleEssential} style={{ padding:"7px 10px", borderRadius:999, border:"1px solid #e2ddd6", background: form.essential ? "#E8F5E9" : "#f4f1ec", color: form.essential ? "#4CAF6E" : "#6d6760", fontSize:12, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:"#4CAF6E", display:"inline-block" }} />
                {t("wizard.essentialShort", { defaultValue: "Essenziale" })}
              </button>
              {mode === "recurring" && (
                <button type="button" onClick={() => set("autoPay", !form.autoPay)} style={{ padding:"7px 10px", borderRadius:999, border:"1px solid #e2ddd6", background: form.autoPay ? "#EBF2FC" : "#f4f1ec", color: form.autoPay ? "#5B8DD9" : "#6d6760", fontSize:12, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ width:18, height:18, borderRadius:6, background:"#EBF2FC", color:"#5B8DD9", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:12, border:"1px solid #c9dbf3" }}>↺</span>
                  {t("wizard.autoShort", { defaultValue: "Automatico" })}
                </button>
              )}
            </div>

            <label style={{ fontSize:11, fontWeight:800, color:"#8f8a83", textTransform:"uppercase", marginTop:6 }}>{t("wizard.category")}</label>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(90px, 1fr))", gap:8, width:"100%" }}>
              {cats.map(c => (
                <button key={c.id} onClick={() => { set("cat", c.id); set("asset", null); }} style={{
                  background: form.cat === c.id ? c.light : "#f4f1ec",
                  border: `2px solid ${form.cat === c.id ? c.color : "#e2ddd6"}`,
                  borderRadius:10, padding:"6px", cursor:"pointer", fontSize:11,
                  fontWeight: form.cat === c.id ? 700 : 600,
                  color: form.cat === c.id ? c.color : "#6d6760",
                  minHeight:36
                }}>
                  <span style={{ fontSize:13 }}>{c.icon}</span> {t(c.labelKey || "", { defaultValue: c.label })}
                </button>
              ))}
            </div>

            {hasAssets && (
              <>
                <label style={{ fontSize:11, fontWeight:800, color:"#8f8a83", textTransform:"uppercase", marginTop:6 }}>{t("wizard.asset")}</label>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {selectedCat.assets.map(a => (
                    <button key={a} onClick={() => set("asset", a)} style={{
                      padding:"8px 12px", borderRadius:999, border:"none", background: form.asset === a ? "#E8855D" : "#f0ebe5", color: form.asset === a ? "#fff" : "#6d6760",
                      fontSize:12, fontWeight:700, cursor:"pointer"
                    }}>{a}</button>
                  ))}
                </div>
              </>
            )}

            {mode === "recurring" && (
              <div style={{ marginTop:8, padding:"12px", borderRadius:14, background:"#f4f1ec", color:"#6d6760", border:"1px solid #e2ddd6" }}>
                <div style={{ fontSize:12, fontWeight:700 }}>{t("recurring.every", { defaultValue: "Ricorrenza" })}: {recurringLabel}</div>
              </div>
            )}
          </div>
        )}

        {step == 2 && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ fontSize:12, color:"#8f8a83", fontWeight:800, textTransform:"uppercase" }}>{t("wizard.docLabel")}</div>
            <div style={{ background:"#fff", borderRadius:16, padding:"14px", border:"1px solid #e2ddd6" }}>
              {form.documents.length === 0 ? (
                <label style={{ display:"block", padding:"12px", borderRadius:12, border:"1px dashed #d4cfc8", background:"#f7f4f0", color:"#6d6760", fontSize:12, fontWeight:700, cursor:"pointer", textAlign:"center" }}>
                  <input type="file" accept="image/*,application/pdf,*/*" style={{ display:"none" }} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > FILE_MAX_BYTES) {
                      onToast ? onToast(t("toast.fileTooLarge", { size: 10 })) : alert(t("toast.fileTooLarge", { size: 10 }));
                      e.target.value = '';
                      return;
                    }
                    try {
                      const base64 = await fileToBase64(file);
                      const doc = { id: Date.now(), type: 'incoming', base64, filename: file.name || "file", contentType: file.type || "application/octet-stream", size: file.size, isImage: isImageType(file.type), uploadDate: new Date().toISOString() };
                      set("documents", [doc]);
                    } catch(err) { onToast ? onToast(t("errors.fileUpload")) : alert(t("errors.fileUpload")); }
                    e.target.value = '';
                  }} />
                  {t("wizard.docUpload")}
                </label>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:8, background:"#fff", borderRadius:12, padding:"8px 10px", border:"1px solid #e2ddd6" }}>
                  <span style={{ fontSize:16 }}>📄</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{form.documents[0].filename}</div>
                    <div style={{ fontSize:10, color:"#8f8a83" }}>{t("wizard.docAttached")}</div>
                  </div>
                  <button type="button" onClick={() => set("documents", [])} style={{ padding:"4px 8px", borderRadius:6, border:"none", background:"#FFF0EC", color:"#E53935", fontSize:11, fontWeight:600, cursor:"pointer" }}>{t("wizard.docRemove")}</button>
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{ flex:1, padding:"12px", borderRadius:14, border:"2px solid #d4cfc8", background:"#fff", color:"#6d6760", fontSize:13, fontWeight:700 }}>
              {t("actions.back")}
            </button>
          )}
          <button onClick={onClose} style={{ flex:1, padding:"12px", borderRadius:14, border:"2px solid #d4cfc8", background:"#fff", color:"#6d6760", fontSize:13, fontWeight:700 }}>
            {t("actions.abandon", { defaultValue: "Abbandona" })}
          </button>
          {step < lastStep ? (
            <button onClick={() => !disableNext && setStep(s => s + 1)} disabled={disableNext} style={{ flex:2, padding:"12px", borderRadius:14, border:"none", background: disableNext ? "#c1bbb4" : "#E8855D", color:"#fff", fontSize:14, fontWeight:800, cursor: disableNext ? "not-allowed" : "pointer" }}>
              {t("actions.next")}
            </button>
          ) : (
            <button onClick={finalize} disabled={!canProceedDetails} style={{ flex:2, padding:"12px", borderRadius:14, border:"none", background: canProceedDetails ? "#E8855D" : "#c1bbb4", color:"#fff", fontSize:14, fontWeight:800 }}>
              {t("actions.save")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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
function AssetSheet({ open, onClose, deadlines, cats, catId, assetName, workLogs, assetDocs, onAddWorkLog, onViewDoc, onCreateDeadline, onUploadAttachments }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("registro");
  const [showAddWork, setShowAddWork] = useState(false);
  const [editingWorkLog, setEditingWorkLog] = useState(null);
  const [viewingWorkLog, setViewingWorkLog] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [schedulePrompt, setSchedulePrompt] = useState(null); // { log, date }
  
  if (!open) return null;

  const cat = cats.find(c => c.id === catId);
  if (!cat) return null;
  const catLabel = t(cat.labelKey || "", { defaultValue: cat.label });

  const assetKey = `${catId}_${assetName.toLowerCase().replace(/\s+/g, '_')}`;
  const assetWorkLogs = (workLogs[assetKey] || []).sort((a, b) => b.date - a.date);

  const assetDeadlines = deadlines
    .filter(d => d.cat === catId && d.asset === assetName)
    .sort((a, b) => a.date - b.date);

  const oneOffDeadlines = assetDeadlines.filter(d => !d.recurring || !d.recurring.enabled);
  const recurringGroups = assetDeadlines.filter(d => d.recurring && d.recurring.enabled).reduce((acc, d) => {
    const key = d.recurring.seriesId || d.title;
    acc[key] = acc[key] || [];
    acc[key].push(d);
    return acc;
  }, {});

  const completed = assetDeadlines.filter(d => d.done);
  const upcoming = assetDeadlines.filter(d => !d.done);
  const totalSpent = completed.filter(d => !d.estimateMissing).reduce((sum, d) => sum + d.budget, 0);

  const nextMaintenance = assetWorkLogs
    .filter(log => log.nextDate instanceof Date && !Number.isNaN(log.nextDate.getTime()))
    .sort((a, b) => a.nextDate - b.nextDate)[0];
  
  const assetDocuments = (assetDocs && assetDocs[assetKey]) ? assetDocs[assetKey] : [];
  const allDocuments = [
    ...assetDocuments,
    ...assetDeadlines.flatMap(d => d.documents || [])
  ].sort((a, b) => {
    const ta = a?.uploadDate ? new Date(a.uploadDate).getTime() : 0;
    const tb = b?.uploadDate ? new Date(b.uploadDate).getTime() : 0;
    return tb - ta;
  });

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
            { id:"registro", label: t("asset.tabs.log") },
            { id:"scadenze", label: t("asset.tabs.deadlines") },
            { id:"panoramica", label: t("asset.tabs.overview") }
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

            {/* Prossima manutenzione */}
            {nextMaintenance ? (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>
                  {t("asset.nextMaintenanceTitle")}
                </div>
                <div style={{ background:"#fff8ee", borderRadius:10, padding:"10px 12px", border:"1px solid #f0e2c9" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>{nextMaintenance.title}</div>
                      <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>
                        {nextMaintenance.nextDate.toLocaleDateString(getLocale())}
                      </div>
                    </div>
                    <div style={{ fontSize:12, fontWeight:700, color: nextMaintenance.nextScheduled ? "#4CAF6E" : "#FB8C00" }}>
                      {nextMaintenance.nextScheduled ? t("asset.nextMaintenanceScheduled") : t("asset.nextMaintenanceUnscheduled")}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              assetWorkLogs.length > 0 && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>
                    {t("asset.nextMaintenanceTitle")}
                  </div>
                  <div style={{ background:"#fff8ee", borderRadius:10, padding:"10px 12px", border:"1px solid #f0e2c9" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>
                        {t("asset.nextMaintenanceMissing")}
                      </div>
                      <div style={{ fontSize:12, fontWeight:700, color:"#FB8C00" }}>
                        {t("asset.nextMaintenanceUnscheduled")}
                      </div>
                    </div>
                  </div>
                </div>
              )
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
                {/* One-off deadlines */}
                {oneOffDeadlines.length > 0 && (
                  <>
                    <div style={{ marginTop:4, fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase" }}>
                      {t("asset.oneOffTitle")}
                    </div>
                    {oneOffDeadlines.map(d => (
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
                  </>
                )}

                {/* Recurring (compacted) */}
                {Object.keys(recurringGroups).length > 0 && (
                  <>
                    <div style={{ marginTop:8, fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase" }}>
                      {t("asset.recurringTitle")}
                    </div>
                    {Object.entries(recurringGroups).map(([seriesId, items]) => {
                      const sorted = items.slice().sort((a, b) => a.date - b.date);
                      const next = sorted.find(d => !d.done) || sorted[0];
                      if (!next) return null;
                      return (
                        <div key={seriesId} style={{
                          background:"#EBF2FC", borderRadius:10, padding:"10px 12px", border:"1px solid #5B8DD966"
                        }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>{next.title}</div>
                              <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>
                                {t("asset.nextOccurrence")}: {next.date.toLocaleDateString(getLocale())} • {next.recurring?.index}/{next.recurring?.total}
                              </div>
                            </div>
                            <div style={{ textAlign:"right" }}>
                              <div style={{ fontSize:14, fontWeight:800, color:"#5B8DD9" }}>€{formatNumber(next.budget)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
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

            {assetDocuments.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>
                  {t("asset.assetDocs", { count: assetDocuments.length })}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {assetDocuments.slice(0, 3).map(doc => (
                    <div key={doc.id} onClick={() => onViewDoc(doc)} style={{ background:"#faf9f7", borderRadius:8, padding:"8px 10px", border:"1px solid #e8e6e0", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                      <span>{doc.isImage ? "🖼️" : "📄"}</span>
                      <span style={{ flex:1, fontSize:11, fontWeight:600, color:"#2d2b26", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {doc.filename}
                      </span>
                      <span style={{ fontSize:10, color:"#8a877f" }}>{t("actions.view")}</span>
                    </div>
                  ))}
                  {assetDocuments.length > 3 && (
                    <div style={{ fontSize:10, color:"#8a877f", textAlign:"center" }}>
                      {t("asset.moreDocs", { count: assetDocuments.length - 3 })}
                    </div>
                  )}
                </div>
              </div>
            )}

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
                    onClick={() => { setViewingWorkLog(log); }}
                    style={{ 
                      background:"#faf9f7", borderRadius:10, padding:"10px", border:"1px solid #e8e6e0",
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
                        <div style={{ fontSize:13, fontWeight:800, color:"#4CAF6E" }}>€{formatNumber(log.cost)}</div>
                      )}
                    </div>
                    
                    {isAuto && log.km && (
                      <div style={{ background:"#fff", borderRadius:6, padding:"5px 8px", marginBottom:6, fontSize:11, color:"#6b6961" }}>
                        {t("asset.kmLabel", { km: log.km.toLocaleString(getLocale()) })}
                        {log.nextKm && ` ${t("asset.kmNext", { km: log.nextKm.toLocaleString(getLocale()) })}`}
                      </div>
                    )}
                    
                    <div style={{ background:"#fff8ee", borderRadius:6, padding:"5px 8px", marginTop:6, fontSize:11, color:"#6b6961", border:"1px solid #f0e2c9", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                      {log.nextDate ? (
                        <>
                          <span>{t("asset.nextMaintenanceTitle")}: {log.nextDate.toLocaleDateString(getLocale())}</span>
                          <span style={{ fontWeight:700, color: log.nextScheduled ? "#4CAF6E" : "#FB8C00" }}>
                            {log.nextScheduled ? t("asset.nextMaintenanceScheduled") : t("asset.nextMaintenanceUnscheduled")}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>{t("asset.nextMaintenanceMissing")}</span>
                          <span style={{ fontWeight:700, color:"#FB8C00" }}>{t("asset.nextMaintenanceUnscheduled")}</span>
                        </>
                      )}
                    </div>
                    
                    {log.description && (
                      <div style={{ fontSize:11, color:"#6b6961", marginTop:6, lineHeight:1.3 }}>{log.description}</div>
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
            onDeleteWorkLog={(id) => {
              onAddWorkLog(assetKey, null, id);
              setEditingWorkLog(null);
              setShowAddWork(false);
            }}
            onSave={(work) => {
              onAddWorkLog(assetKey, work, editingWorkLog?.id);
              setShowAddWork(false);
              setEditingWorkLog(null);
            }}
            onUploadAttachments={onUploadAttachments}
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
            onCreateCompleted={(formData) => {
              if (!onCreateDeadline) return;
              onCreateDeadline({
                title: formData.title,
                date: formData.date,
                cost: formData.cost ? parseFloat(formData.cost) : 0,
                description: formData.description,
                completed: true,
                documents: formData.documents || []
              });
            }}
          />
        )}

        {/* Work Log View Modal */}
        {viewingWorkLog && (
          <div onClick={() => setViewingWorkLog(null)} style={{
            position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:260,
            display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)",
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background:"#fff", borderRadius:18, padding:"20px 22px", width:"90%", maxWidth:420,
              animation:"popIn .22s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"80vh", overflowY:"auto"
            }}>
              <style>{`@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
              <h3 style={{ margin:"0 0 12px", fontSize:17, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>
                {viewingWorkLog.title}
              </h3>
              <div style={{ fontSize:12, color:"#8a877f", marginBottom:12 }}>
                {viewingWorkLog.date.toLocaleDateString(getLocale())}
              </div>

              {(viewingWorkLog.cost > 0 || (isAuto && viewingWorkLog.km)) && (
                <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                  {viewingWorkLog.cost > 0 && (
                    <div style={{ background:"#E8F5E9", color:"#4CAF6E", borderRadius:8, padding:"6px 10px", fontSize:12, fontWeight:700 }}>
                      €{formatNumber(viewingWorkLog.cost)}
                    </div>
                  )}
                  {isAuto && viewingWorkLog.km && (
                    <div style={{ background:"#EBF2FC", color:"#5B8DD9", borderRadius:8, padding:"6px 10px", fontSize:12, fontWeight:700 }}>
                      {t("asset.kmLabel", { km: viewingWorkLog.km.toLocaleString(getLocale()) })}
                    </div>
                  )}
                </div>
              )}

              {viewingWorkLog.nextDate && (
                <div style={{ background:"#fff8ee", borderRadius:10, padding:"8px 10px", border:"1px solid #f0e2c9", fontSize:12, color:"#6b6961", marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                  <span>{t("asset.nextMaintenanceTitle")}: {viewingWorkLog.nextDate.toLocaleDateString(getLocale())}</span>
                  <span style={{ fontWeight:700, color: viewingWorkLog.nextScheduled ? "#4CAF6E" : "#FB8C00" }}>
                    {viewingWorkLog.nextScheduled ? t("asset.nextMaintenanceScheduled") : t("asset.nextMaintenanceUnscheduled")}
                  </span>
                </div>
              )}

              {viewingWorkLog.description && (
                <div style={{ fontSize:12, color:"#6b6961", background:"#faf9f7", borderRadius:10, padding:"8px 10px", marginBottom:12, lineHeight:1.4 }}>
                  {viewingWorkLog.description}
                </div>
              )}

              <div style={{ background:"#faf9f7", borderRadius:10, padding:"8px 10px", marginBottom:14 }}>
                <div style={{ fontSize:10, color:"#8a877f", fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>{t("docs.title")}</div>
                {viewingWorkLog.attachments && viewingWorkLog.attachments.length > 0 ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {viewingWorkLog.attachments.map(doc => (
                      <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", borderRadius:8, padding:"6px 8px", border:"1px solid #e8e6e0" }}>
                        <span style={{ fontSize:14 }}>{doc.isImage ? "🖼️" : "📄"}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{doc.filename}</div>
                        </div>
                        <button onClick={() => onViewDoc(doc)} style={{ padding:"3px 7px", borderRadius:6, border:"none", background:"#EBF2FC", color:"#5B8DD9", fontSize:10, fontWeight:600, cursor:"pointer" }}>{t("actions.view")}</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize:11, color:"#b5b2a8", fontStyle:"italic" }}>{t("docs.none")}</div>
                )}
              </div>

              <div style={{ display:"flex", gap:10 }}>
                <button onClick={() => {
                  setEditingWorkLog(viewingWorkLog);
                  setShowAddWork(true);
                  setViewingWorkLog(null);
                }} style={{ flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:13, fontWeight:700, color:"#6b6961" }}>
                  {t("actions.edit")}
                </button>
                <button onClick={() => {
                  if (window.confirm(t("workLog.deleteConfirm"))) {
                    onAddWorkLog(assetKey, null, viewingWorkLog.id);
                    setViewingWorkLog(null);
                  }
                }} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#FFF0EC", color:"#E53935", cursor:"pointer", fontSize:13, fontWeight:700 }}>
                  {t("actions.delete")}
                </button>
                <button onClick={() => setViewingWorkLog(null)} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>
                  {t("actions.close")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Schedule next maintenance modal */}
        {schedulePrompt && (
          <div onClick={e => e.target === e.currentTarget && setSchedulePrompt(null)} style={{
            position:"fixed", inset:0, background:"rgba(18,17,13,.7)", zIndex:260,
            display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)",
          }}>
            <div style={{
              background:"#fff", borderRadius:18, padding:"20px 22px", width:"90%", maxWidth:380,
              animation:"popIn .22s cubic-bezier(.34,1.56,.64,1) both"
            }}>
              <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>
                {t("asset.scheduleTitle")}
              </h3>
              <div style={{ fontSize:12, color:"#8a877f", marginBottom:12 }}>
                {t("asset.scheduleHint")}
              </div>
              <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                {[1,12,24].map(m => (
                  <button key={m} type="button" onClick={() => {
                    const base = new Date(schedulePrompt.log.date);
                    base.setMonth(base.getMonth() + m);
                    setSchedulePrompt(p => ({ ...p, date: base.toISOString().split('T')[0] }));
                  }} style={{
                    flex:1, padding:"8px 10px", borderRadius:10, border:"1px solid #e8e6e0", background:"#faf9f7",
                    fontSize:12, fontWeight:700, cursor:"pointer"
                  }}>
                    +{m} {t("range.month", { defaultValue:"Mese" })}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={schedulePrompt.date}
                onChange={e => setSchedulePrompt(p => ({ ...p, date: e.target.value }))}
                style={dateInpModal}
              />
              <div style={{ display:"flex", gap:10, marginTop:16 }}>
                <button onClick={() => setSchedulePrompt(null)} style={{
                  flex:1, padding:"10px", borderRadius:10, border:"2px solid #e8e6e0", background:"#fff",
                  fontSize:13, fontWeight:700, color:"#6b6961", cursor:"pointer"
                }}>{t("actions.cancel")}</button>
                <button onClick={() => {
                  if (!schedulePrompt.date || !onCreateDeadline) return;
                  const updated = {
                    ...schedulePrompt.log,
                    nextDate: new Date(schedulePrompt.date + "T00:00:00"),
                    nextScheduled: true
                  };
                  onAddWorkLog(assetKey, updated, schedulePrompt.log.id);
                  onCreateDeadline({
                    title: updated.title,
                    date: schedulePrompt.date,
                    cost: updated.cost ? Number(updated.cost) : 0,
                    description: updated.description || ""
                  });
                  setSchedulePrompt(null);
                }} style={{
                  flex:1, padding:"10px", borderRadius:10, border:"none", background:"#2d2b26",
                  fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer"
                }}>{t("actions.save")}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ADD WORK MODAL ──────────────────────────────────── */
function AddWorkModal({ open, onClose, assetKey, assetName, catId, isAuto, onSave, onCreateDeadline, onCreateCompleted, onDeleteWorkLog, onUploadAttachments, prefill, workLog }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: workLog?.title || prefill?.title || "",
    date: workLog?.date ? workLog.date.toISOString().split('T')[0] : (prefill?.date || new Date().toISOString().split('T')[0]),
    km: workLog?.km || "",
    nextKm: workLog?.nextKm || "",
    description: workLog?.description || prefill?.description || "",
    cost: workLog?.cost || prefill?.cost || "",
    nextDate: workLog?.nextDate ? workLog.nextDate.toISOString().split('T')[0] : (prefill?.nextDate || ""),
    createDeadline: workLog?.createDeadline ?? prefill?.createDeadline ?? true,
    createCompleted: workLog?.createCompleted ?? prefill?.createCompleted ?? false,
    enableNext: !!(workLog?.nextDate || prefill?.nextDate)
  });
  const [existingAttachments, setExistingAttachments] = useState(workLog?.attachments || []);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      if (workLog) {
        setForm({
          title: workLog.title,
          date: workLog.date.toISOString().split('T')[0],
          km: workLog.km || "",
          nextKm: workLog.nextKm || "",
          description: workLog.description || "",
          cost: workLog.cost || "",
          nextDate: workLog.nextDate ? workLog.nextDate.toISOString().split('T')[0] : "",
          createDeadline: workLog.createDeadline ?? true,
          createCompleted: workLog.createCompleted ?? false,
          enableNext: !!workLog.nextDate
        });
        setExistingAttachments(workLog.attachments || []);
        setPendingFiles([]);
      } else if (prefill) {
        setForm({
          title: prefill.title || "",
          date: prefill.date || new Date().toISOString().split('T')[0],
          km: "",
          nextKm: "",
          description: prefill.description || "",
          cost: prefill.cost || "",
          nextDate: prefill.nextDate || "",
          createDeadline: prefill.createDeadline ?? true,
          createCompleted: prefill.createCompleted ?? false,
          enableNext: !!prefill.nextDate
        });
        setExistingAttachments([]);
        setPendingFiles([]);
      }
    }
  }, [open, prefill, workLog]);

  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const modeLabel = workLog ? t("workLog.edit") : t("workLog.new");

  const handleSave = async () => {
    if (!form.title || !form.date) return;
    
    const saved = {
      id: workLog?.id || Date.now(),
      title: form.title,
      date: new Date(form.date + "T00:00:00"),
      km: form.km ? parseInt(form.km) : null,
      nextKm: form.nextKm ? parseInt(form.nextKm) : null,
      description: form.description,
      cost: form.cost ? parseFloat(form.cost) : 0,
      nextDate: form.nextDate ? new Date(form.nextDate + "T00:00:00") : null,
      createDeadline: form.createDeadline,
      nextScheduled: form.enableNext && form.createDeadline && !!form.nextDate,
      createCompleted: form.createCompleted
    };
    let uploaded = [];
    if (pendingFiles.length && onUploadAttachments) {
      setUploading(true);
      try {
        uploaded = await onUploadAttachments(pendingFiles, {
          scope: "worklog",
          assetKey,
          workLogId: saved.id
        });
      } catch (err) {
        showToast(t("toast.documentUploadError"));
      } finally {
        setUploading(false);
      }
      if (uploaded.length < pendingFiles.length) {
        showToast(t("toast.uploadIncomplete"));
        return;
      }
    }
    const attachments = [...(existingAttachments || []), ...uploaded];
    onSave({ ...saved, attachments });

    if (form.enableNext && form.nextDate && form.createDeadline && onCreateDeadline) {
      onCreateDeadline({
        title: form.title,
        date: form.nextDate,
        cost: form.cost ? parseFloat(form.cost) : 0,
        description: form.description
      });
    }

    if (form.createCompleted && onCreateCompleted) {
      onCreateCompleted({
        title: form.title,
        date: form.date,
        cost: form.cost ? parseFloat(form.cost) : 0,
        description: form.description,
        documents: attachments
      });
    }
    onClose();
  };

  const handleAddFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const remaining = MAX_ATTACHMENTS - existingAttachments.length - pendingFiles.length;
    if (remaining <= 0) return;
    const slice = files.slice(0, remaining);
    setPendingFiles(prev => [...prev, ...slice]);
  };

  const removePendingFile = (index) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
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
        animation:"popIn .22s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"80vh", overflowY:"auto", overflowX:"hidden"
      }}>
        <style>{`@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
        
        <h3 style={{ margin:"0 0 16px", fontSize:17, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>
          {t("workLog.title", { mode: modeLabel, asset: assetName })}
        </h3>

        <label style={lbl}>{t("workLog.fields.title")}</label>
        <input value={form.title} onChange={e => set("title", e.target.value)} placeholder={t("workLog.placeholders.title")} style={inp}/>

        <label style={{ ...lbl, marginTop:12 }}>{t("workLog.fields.date")}</label>
        <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={dateInpModal}/>

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

        {/* Completed deadline toggle */}
        <div style={{ marginTop:12, padding:"12px", borderRadius:12, border:"1px solid #e8e6e0", background:"#faf9f7" }}>
          <label style={{ display:"flex", alignItems:"flex-start", gap:10, fontSize:12, color:"#6b6961" }}>
            <input type="checkbox" checked={!!form.createCompleted} onChange={e => set("createCompleted", e.target.checked)} />
            <span>
              <strong style={{ color:"#2d2b26" }}>{t("workLog.createCompleted")}</strong>
              <div style={{ fontSize:11, marginTop:4, color:"#8a877f" }}>{t("workLog.createCompletedHint")}</div>
            </span>
          </label>
        </div>

        {/* Next maintenance (optional) */}
        <div style={{ marginTop:16, padding:"12px", borderRadius:12, border:"1px solid #f0e2c9", background:"#fff8ee" }}>
          <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:12, color:"#6b6961", marginBottom:10 }}>
            <input
              type="checkbox"
              checked={!!form.enableNext}
              onChange={e => {
                const enabled = e.target.checked;
                set("enableNext", enabled);
                if (!enabled) {
                  set("nextDate", "");
                  set("createDeadline", false);
                } else {
                  set("createDeadline", true);
                }
              }}
            />
            <strong style={{ color:"#2d2b26" }}>{t("workLog.nextOptional")}</strong>
          </label>

          {form.enableNext && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>
                {t("workLog.fields.nextDate")}
              </div>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            {[1,12,24].map(m => (
              <button key={m} type="button" onClick={() => {
                const base = new Date(form.date + "T00:00:00");
                base.setMonth(base.getMonth() + m);
                set("nextDate", base.toISOString().split('T')[0]);
                set("createDeadline", true);
              }} style={{
                flex:1, padding:"8px 10px", borderRadius:10, border:"1px solid #f0e2c9", background:"#fff",
                fontSize:12, fontWeight:700, cursor:"pointer"
              }}>{m === 1 ? t("workLog.quick1") : (m === 12 ? t("workLog.quick12") : t("workLog.quick24"))}</button>
            ))}
          </div>
              <input type="date" value={form.nextDate} onChange={e => set("nextDate", e.target.value)} style={dateInpModal}/>
              <label style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, fontSize:12, color:"#6b6961" }}>
                <input type="checkbox" checked={!!form.createDeadline} onChange={e => set("createDeadline", e.target.checked)} />
                {t("workLog.createDeadline")}
              </label>
            </>
          )}
        </div>

        {/* Attachments */}
        <div style={{ marginTop:16, padding:"12px", borderRadius:12, border:"1px solid #e8e6e0", background:"#faf9f7" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>
            {t("attachments.title")}
          </div>
          <div style={{ fontSize:11, color:"#8a877f", marginBottom:10 }}>
            {t("attachments.hint", { max: MAX_ATTACHMENTS })}
          </div>

          {existingAttachments.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
              {existingAttachments.map((doc) => (
                <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:8, background:"#fff", borderRadius:8, padding:"6px 10px", border:"1px solid #e8e6e0" }}>
                  <span style={{ fontSize:14 }}>{doc.isImage ? "🖼️" : "📄"}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{doc.filename}</div>
                    <div style={{ fontSize:10, color:"#8a877f" }}>{t("attachments.alreadyUploaded")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pendingFiles.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
              {pendingFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} style={{ display:"flex", alignItems:"center", gap:8, background:"#fff", borderRadius:8, padding:"6px 10px", border:"1px solid #e8e6e0" }}>
                  <span style={{ fontSize:14 }}>{isImageType(file.type) ? "🖼️" : "📄"}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{file.name}</div>
                    <div style={{ fontSize:10, color:"#8a877f" }}>{t("attachments.pending")}</div>
                  </div>
                  <button type="button" onClick={() => removePendingFile(idx)} style={{ padding:"4px 8px", borderRadius:6, border:"none", background:"#FFF0EC", color:"#E53935", fontSize:11, fontWeight:600, cursor:"pointer" }}>
                    {t("actions.remove")}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display:"flex", gap:8 }}>
            <label style={{ flex:1, display:"block", padding:"10px 12px", borderRadius:10, border:"1px dashed #e8e6e0", background:"#fff", color:"#6b6961", fontSize:12, fontWeight:700, cursor:"pointer", textAlign:"center" }}>
              <input type="file" accept="image/*,application/pdf,*/*" multiple style={{ display:"none" }} onChange={(e) => { handleAddFiles(e.target.files); e.target.value = ""; }} />
              {t("attachments.upload")}
            </label>
          </div>
        </div>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>{t("actions.cancel")}</button>
          {workLog && onDeleteWorkLog && (
            <button onClick={() => {
              if (window.confirm(t("workLog.deleteConfirm"))) {
                onDeleteWorkLog(workLog.id);
                onClose();
              }
            }} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#FFF0EC", color:"#E53935", cursor:"pointer", fontSize:14, fontWeight:700 }}>{t("actions.delete")}</button>
          )}
          <button onClick={handleSave} disabled={!form.title || !form.date || uploading} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background: form.title && form.date && !uploading ? "#2d2b26" : "#e8e6e0", color:"#fff", cursor: form.title && form.date && !uploading ? "pointer" : "not-allowed", fontSize:14, fontWeight:700 }}>
            {uploading ? t("attachments.uploading") : t("actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
function CategorySheet({ open, onClose, cats, onUpdateCats, deadlines, workLogs, onResetAll, onAddAsset }) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState(null);
  const [newAsset, setNewAsset] = useState("");
  const [assetFiles, setAssetFiles] = useState([]);
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCat, setNewCat] = useState({ label:"", icon:"", color:"#E8855D" });

  useEffect(() => {
    setNewAsset("");
    setAssetFiles([]);
  }, [editingId]);

  if (!open) return null;

  const addAsset = async (catId) => {
    if (!newAsset.trim()) return;
    const name = newAsset.trim();
    if (onAddAsset) {
      await onAddAsset(catId, name, assetFiles);
    } else {
      onUpdateCats(cats.map(c => c.id === catId ? { ...c, assets: [...c.assets, name] } : c));
    }
    setNewAsset("");
    setAssetFiles([]);
  };

  const removeAsset = (catId, asset) => {
    onUpdateCats(cats.map(c => c.id === catId ? { ...c, assets: c.assets.filter(a => a !== asset) } : c));
  };

  const handleAddAssetFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const remaining = MAX_ATTACHMENTS - assetFiles.length;
    if (remaining <= 0) return;
    setAssetFiles(prev => [...prev, ...files.slice(0, remaining)]);
  };

  const removeAssetFile = (index) => {
    setAssetFiles(prev => prev.filter((_, i) => i !== index));
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

                <div style={{ marginTop:10, padding:"10px", borderRadius:10, border:"1px solid #e8e6e0", background:"#faf9f7" }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#8a877f", textTransform:"uppercase", marginBottom:6 }}>
                    {t("attachments.title")}
                  </div>
                  <div style={{ fontSize:10, color:"#8a877f", marginBottom:8 }}>
                    {t("attachments.hint", { max: MAX_ATTACHMENTS })}
                  </div>
                  {assetFiles.length > 0 && (
                    <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:8 }}>
                      {assetFiles.map((file, idx) => (
                        <div key={`${file.name}-${idx}`} style={{ display:"flex", alignItems:"center", gap:8, background:"#fff", borderRadius:8, padding:"6px 10px", border:"1px solid #e8e6e0" }}>
                          <span style={{ fontSize:12 }}>{isImageType(file.type) ? "🖼️" : "📄"}</span>
                          <span style={{ flex:1, fontSize:11, fontWeight:600, color:"#2d2b26", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{file.name}</span>
                          <button type="button" onClick={() => removeAssetFile(idx)} style={{ padding:"2px 6px", borderRadius:6, border:"none", background:"#FFF0EC", color:"#E53935", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                            {t("actions.remove")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display:"flex", gap:6 }}>
                    <label style={{ flex:1, display:"block", padding:"8px 10px", borderRadius:8, border:"1px dashed #e8e6e0", background:"#fff", color:"#6b6961", fontSize:11, fontWeight:700, cursor:"pointer", textAlign:"center" }}>
                      <input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={(e) => { handleAddAssetFiles(e.target.files); e.target.value = ""; }} />
                      {t("attachments.capture")}
                    </label>
                    <label style={{ flex:1, display:"block", padding:"8px 10px", borderRadius:8, border:"1px dashed #e8e6e0", background:"#fff", color:"#6b6961", fontSize:11, fontWeight:700, cursor:"pointer", textAlign:"center" }}>
                      <input type="file" accept="image/*,application/pdf,*/*" multiple style={{ display:"none" }} onChange={(e) => { handleAddAssetFiles(e.target.files); e.target.value = ""; }} />
                      {t("attachments.upload")}
                    </label>
                  </div>
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
  const pendingDeleteRef = useRef(new Set());
  const dirtyDeadlinesRef = useRef(false);
  const [remoteInfo, setRemoteInfo] = useState({ count: null, lastSync: null, error: null });
  const deadlinesRef = useRef([]);
  const prevDeadlinesRef = useRef([]);
  const saveRetryRef = useRef(null);
  const deadlinesSaveTimerRef = useRef(null);
  const syncingCountRef = useRef(0);
  const lastSyncRef = useRef(0);
  const lastFullSyncRef = useRef(0);
  const deadlinesVersionRef = useRef(0);
  const pollStateRef = useRef({ timer: null, backoffMs: POLL_BASE_MS });
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState("login"); // login | signup
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [showAllMandatory, setShowAllMandatory] = useState(false);
  const [showAllOneOff, setShowAllOneOff] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem("lifetrack_sync_enabled");
      return saved === null ? true : saved === "true";
    } catch (err) {
      return true;
    }
  });
  const DEV_EMAIL = "mstanglino@gmail.com";
  const isDevUser = (user?.email || "").toLowerCase() === DEV_EMAIL;
  const [showDev, setShowDev] = useState(false);
  const syncNowRef = useRef(null);
  const lastManualSyncRef = useRef(0);
  const lastFocusCheckRef = useRef(0);
  const listRef = useRef(null);
  const pullStartRef = useRef(0);
  const pullActiveRef = useRef(false);
  const [pullOffset, setPullOffset] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [pullSyncing, setPullSyncing] = useState(false);

  // App state (must be declared before any hooks that reference them)
  const [cats, setCats] = useState(DEFAULT_CATS);
  const [deadlines, setDeadlines] = useState(() => {
    try {
      const saved = localStorage.getItem('lifetrack_deadlines');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map(normalizeDeadline).filter(Boolean);
        }
      }
    } catch (err) {
      console.warn("Local deadlines parse error:", err);
    }
    return [];
  });
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
  const [assetDocs, setAssetDocs] = useState(() => {
    const saved = localStorage.getItem('lifetrack_asset_docs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return normalizeAssetDocs(parsed);
      } catch (err) {
        console.warn("AssetDocs parse error:", err);
      }
    }
    return {}; // { "casa_colico": [doc] }
  });
  const [pets, setPets] = useState(() => {
    const saved = localStorage.getItem('lifetrack_pets');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.warn("Pets parse error:", err);
      }
    }
    return [];
  });
  const [petEvents, setPetEvents] = useState(() => {
    const saved = localStorage.getItem('lifetrack_pet_events');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.warn("Pet events parse error:", err);
      }
    }
    return [];
  });
  const [petDeadlines, setPetDeadlines] = useState(() => {
    const saved = localStorage.getItem('lifetrack_pet_deadlines');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.warn("Pet deadlines parse error:", err);
      }
    }
    return [];
  });
  const [petDocs, setPetDocs] = useState(() => {
    const saved = localStorage.getItem('lifetrack_pet_docs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.warn("Pet docs parse error:", err);
      }
    }
    return [];
  });
  const [range, setRange] = useState("mese");
  const [periodOffset, setPeriodOffset] = useState(0);

  const devStats = (() => {
    const totalDeadlines = deadlines.length;
    const totalWorkLogs = Object.values(workLogs || {}).reduce((sum, logs) => sum + (logs?.length || 0), 0);
    const totalAssetDocs = Object.values(assetDocs || {}).reduce((sum, docs) => sum + (docs?.length || 0), 0);
    const totalPets = pets.length;
    const totalPetEvents = petEvents.length;
    const totalPetDeadlines = petDeadlines.length;
    const totalPetDocs = petDocs.length;
    const workLogAttachments = Object.values(workLogs || {}).reduce(
      (sum, logs) => sum + (logs || []).reduce((inner, log) => inner + ((log?.attachments || []).length), 0),
      0
    );
    const deadlineDocs = deadlines.reduce((sum, d) => sum + ((d?.documents || []).length), 0);
    const totalAttachments = totalAssetDocs + workLogAttachments + deadlineDocs + totalPetDocs;
    const lastSync = (() => {
      try { return localStorage.getItem("lifetrack_last_sync"); } catch (err) { return null; }
    })();
    const lastFullSync = (() => {
      try { return localStorage.getItem("lifetrack_last_full_sync"); } catch (err) { return null; }
    })();
    return {
      totalDeadlines,
      totalWorkLogs,
      totalAssetDocs,
      totalPets,
      totalPetEvents,
      totalPetDeadlines,
      totalPetDocs,
      workLogAttachments,
      deadlineDocs,
      totalAttachments,
      lastSync,
      lastFullSync
    };
  })();

  useEffect(() => {
    deadlinesRef.current = deadlines;
  }, [deadlines]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("lifetrack_last_sync");
      const storedFull = localStorage.getItem("lifetrack_last_full_sync");
      const storedVersion = localStorage.getItem("lifetrack_deadlines_version");
      lastSyncRef.current = stored ? parseInt(stored, 10) || 0 : 0;
      lastFullSyncRef.current = storedFull ? parseInt(storedFull, 10) || 0 : 0;
      deadlinesVersionRef.current = storedVersion ? parseInt(storedVersion, 10) || 0 : 0;
    } catch (err) {
      lastSyncRef.current = 0;
      lastFullSyncRef.current = 0;
      deadlinesVersionRef.current = 0;
    }
  }, []);

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

    const mergeDeadlines = (remote, local) => {
      const merged = [];
      const seen = new Set();
      // Remote wins for same id, but keep local items missing in remote
      (remote || []).forEach(d => {
        if (!d) return;
        const id = String(d.id);
        if (pendingDeleteRef.current.has(id) && !d.deleted) return;
        seen.add(id);
        merged.push(d);
      });
      (local || []).forEach(d => {
        if (!d) return;
        const id = String(d.id);
        if (pendingDeleteRef.current.has(id) && !d.deleted) return;
        if (!seen.has(id)) merged.push(d);
      });
      return merged;
    };

    const applyDelta = (changes, local) => {
      if (!changes || changes.length === 0) return local || [];
      const map = new Map((local || []).map(d => [String(d.id), d]));
      changes.forEach(d => {
        if (!d) return;
        const id = String(d.id);
        if (pendingDeleteRef.current.has(id) && !d.deleted) return;
        map.set(id, d);
      });
      return Array.from(map.values());
    };

    const scheduleNext = (delay) => {
      if (cancelled) return;
      if (!SYNC_POLL_ENABLED) return;
      if (pollStateRef.current.timer) clearTimeout(pollStateRef.current.timer);
      pollStateRef.current.timer = setTimeout(() => fetchOnce("poll"), delay);
    };

    const fetchOnce = async (reason = "poll") => {
      if (cancelled) return;
      if (!syncEnabled) return;
      if (reason === "poll" && !SYNC_POLL_ENABLED) return;
      if (reason === "poll" && (pendingSaveRef.current || syncing)) {
        scheduleNext(Math.max(pollStateRef.current.backoffMs, POLL_BASE_MS));
        return;
      }
      if (reason === "poll" && remoteInfo.lastSync && (Date.now() - remoteInfo.lastSync) < MIN_POLL_GAP_MS) {
        scheduleNext(pollStateRef.current.backoffMs);
        return;
      }
      if (document.visibilityState === "hidden") {
        scheduleNext(Math.max(pollStateRef.current.backoffMs, POLL_BASE_MS * 2));
        return;
      }
      try {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        if (!userSnap.exists()) {
          await setDoc(userRef, { categories: DEFAULT_CATS, workLogs: {}, assetDocs: {}, pets: [], petEvents: [], petDeadlines: [], petDocs: [], deadlinesVersion: 0, schemaVersion: 2, createdAt: new Date().toISOString() }, { merge: true });
        }
        await migrateLegacyDeadlines(userData);

        const nowTs = Date.now();
        const parsedWorkLogs = normalizeWorkLogs(userData.workLogs);
        const parsedAssetDocs = normalizeAssetDocs(userData.assetDocs);
        const parsedPets = Array.isArray(userData.pets) ? userData.pets : [];
        const parsedPetEvents = Array.isArray(userData.petEvents) ? userData.petEvents : [];
        const parsedPetDeadlines = Array.isArray(userData.petDeadlines) ? userData.petDeadlines : [];
        const parsedPetDocs = Array.isArray(userData.petDocs) ? userData.petDocs : [];

        const remoteVersion = typeof userData.deadlinesVersion === "number" ? userData.deadlinesVersion : 0;
        const localVersion = deadlinesVersionRef.current || 0;
        const versionMatches = remoteVersion > 0 && localVersion > 0 && remoteVersion === localVersion;
        const doFullSync = reason === "repair" || !lastSyncRef.current || !lastFullSyncRef.current || (nowTs - lastFullSyncRef.current) > FULL_SYNC_EVERY_MS;

        if (!doFullSync && versionMatches) {
          pollStateRef.current.backoffMs = POLL_BASE_MS;
          const visibleCount = (deadlinesRef.current || []).filter(d => !d?.deleted).length;
          setRemoteInfo({ count: visibleCount, lastSync: Date.now(), error: null });
          lastFocusCheckRef.current = Date.now();
          if (!cancelled && !pendingSaveRef.current) {
            suppressMetaRef.current = true;
            setCats(userData.categories || DEFAULT_CATS);
            setWorkLogs(parsedWorkLogs);
            setAssetDocs(parsedAssetDocs);
            setPets(parsedPets);
            setPetEvents(parsedPetEvents);
            setPetDeadlines(parsedPetDeadlines);
            setPetDocs(parsedPetDocs);
          }
          scheduleNext(pollStateRef.current.backoffMs);
          return;
        }

        let remoteDeadlines = [];
        let maxUpdatedAt = 0;

        if (doFullSync) {
          const deadlinesSnap = await getDocs(deadlinesCol);
          remoteDeadlines = deadlinesSnap.docs
            .map(snap => {
              const data = snap.data();
              const id = data.id ?? snap.id;
              if (data.updatedAt && data.updatedAt > maxUpdatedAt) maxUpdatedAt = data.updatedAt;
              return normalizeDeadline({ ...data, id });
            })
            .filter(Boolean);
          lastFullSyncRef.current = nowTs;
          try { localStorage.setItem("lifetrack_last_full_sync", String(nowTs)); } catch (err) {}
        } else {
          const q = query(deadlinesCol, where("updatedAt", ">", lastSyncRef.current || 0), orderBy("updatedAt"));
          const deltaSnap = await getDocs(q);
          remoteDeadlines = deltaSnap.docs
            .map(snap => {
              const data = snap.data();
              const id = data.id ?? snap.id;
              if (data.updatedAt && data.updatedAt > maxUpdatedAt) maxUpdatedAt = data.updatedAt;
              return normalizeDeadline({ ...data, id });
            })
            .filter(Boolean);
        }
        if (pendingDeleteRef.current.size > 0) {
          remoteDeadlines = remoteDeadlines.filter(d => !pendingDeleteRef.current.has(String(d.id)) || d?.deleted);
        }

        if (doFullSync && remoteDeadlines.length === 0) {
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

        if (remoteVersion === 0) {
          const newVersion = nowTs;
          try {
            await setDoc(userRef, { deadlinesVersion: newVersion }, { merge: true });
            deadlinesVersionRef.current = newVersion;
            localStorage.setItem("lifetrack_deadlines_version", String(newVersion));
          } catch (err) {
            console.warn("Deadlines version init error:", err);
          }
        } else {
          deadlinesVersionRef.current = remoteVersion;
          try { localStorage.setItem("lifetrack_deadlines_version", String(remoteVersion)); } catch (err) {}
        }

        const nextSync = maxUpdatedAt || nowTs;
        lastSyncRef.current = nextSync;
        try { localStorage.setItem("lifetrack_last_sync", String(nextSync)); } catch (err) {}

        pollStateRef.current.backoffMs = POLL_BASE_MS;
        setRemoteInfo({ count: remoteDeadlines.length, lastSync: Date.now(), error: null });
        if (!cancelled && !pendingSaveRef.current) {
          suppressDeadlinesRef.current = true;
          suppressMetaRef.current = true;
          const localCurrent = deadlinesRef.current || [];
          const nextDeadlines = doFullSync
            ? mergeDeadlines(remoteDeadlines, localCurrent)
            : applyDelta(remoteDeadlines, localCurrent);
          setDeadlines(nextDeadlines);
          setCats(userData.categories || DEFAULT_CATS);
          setWorkLogs(parsedWorkLogs);
          setAssetDocs(parsedAssetDocs);
          setPets(parsedPets);
          setPetEvents(parsedPetEvents);
          setPetDeadlines(parsedPetDeadlines);
          setPetDocs(parsedPetDocs);
        }
      } catch (error) {
        console.error("Firebase poll error:", error);
        const code = error?.code || error?.message || "unknown";
        const multiplier = code === "resource-exhausted" ? 4 : 1.5;
        pollStateRef.current.backoffMs = Math.min(Math.round(pollStateRef.current.backoffMs * multiplier), POLL_MAX_MS);
        if (code === "resource-exhausted") {
          pollStateRef.current.backoffMs = POLL_MAX_MS;
        }
        setRemoteInfo({ count: null, lastSync: null, error: code });
      } finally {
        scheduleNext(pollStateRef.current.backoffMs);
      }
    };
    syncNowRef.current = fetchOnce;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastFocusCheckRef.current >= FOCUS_SYNC_GAP_MS) {
          lastFocusCheckRef.current = now;
          fetchOnce("focus");
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    fetchOnce("init");
    return () => {
      cancelled = true;
      if (pollStateRef.current.timer) clearTimeout(pollStateRef.current.timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user, syncEnabled]);

  const saveDeadlines = async (force = false) => {
    if (!user || loading || !syncEnabled) return;
    if (pendingSaveRef.current && !force) return;
    pendingSaveRef.current = true;
    startSync();
    const current = deadlinesRef.current || [];
    const prevMap = new Map((prevDeadlinesRef.current || []).map(d => [String(d.id), d]));
    const changed = current.filter(d => {
      const prev = prevMap.get(String(d.id));
      return !prev || !isSameDeadline(prev, d);
    });

    try {
      if (changed.length) {
        const now = Date.now();
        const chunkSize = 400;
        for (let i = 0; i < changed.length; i += chunkSize) {
          const batch = writeBatch(db);
          changed.slice(i, i + chunkSize).forEach(d => {
            const docId = String(d.id);
            const payload = stripUndefined({ ...d, id: d.id, updatedAt: now });
            batch.set(doc(db, 'users', user.uid, 'deadlines', docId), payload, { merge: true });
          });
          await batch.commit();
        }
        await setDoc(doc(db, 'users', user.uid), {
          deadlinesVersion: now,
          lastUpdate: new Date().toISOString()
        }, { merge: true });
        deadlinesVersionRef.current = now;
        try { localStorage.setItem("lifetrack_deadlines_version", String(now)); } catch (err) {}
      }
      prevDeadlinesRef.current = current;
      pendingSaveRef.current = false;
      dirtyDeadlinesRef.current = false;
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
      pendingSaveRef.current = false;
      endSync();
      showToast(t("toast.syncError", { code: error?.code || "unknown" }));
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
    if (!user || loading || !syncEnabled) return;
    if (suppressDeadlinesRef.current) {
      suppressDeadlinesRef.current = false;
      prevDeadlinesRef.current = deadlines;
      return;
    }
    dirtyDeadlinesRef.current = true;
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
          assetDocs,
          pets,
          petEvents,
          petDeadlines,
          petDocs,
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
  }, [cats, workLogs, assetDocs, pets, petEvents, petDeadlines, petDocs, user, loading]);

  // Save to localStorage whenever cats or deadlines change
  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_categories', JSON.stringify(cats));
    } catch (err) {
      console.warn("LocalStorage categories error:", err);
    }
  }, [cats]);

  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_deadlines', JSON.stringify(deadlines));
    } catch (err) {
      console.warn("LocalStorage deadlines error:", err);
    }
  }, [deadlines]);

  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_worklogs', JSON.stringify(workLogs));
    } catch (err) {
      console.warn("LocalStorage worklogs error:", err);
    }
  }, [workLogs]);

  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_asset_docs', JSON.stringify(assetDocs));
    } catch (err) {
      console.warn("LocalStorage assetDocs error:", err);
    }
  }, [assetDocs]);

  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_pets', JSON.stringify(pets));
    } catch (err) {
      console.warn("LocalStorage pets error:", err);
    }
  }, [pets]);

  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_pet_events', JSON.stringify(petEvents));
    } catch (err) {
      console.warn("LocalStorage pet events error:", err);
    }
  }, [petEvents]);

  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_pet_deadlines', JSON.stringify(petDeadlines));
    } catch (err) {
      console.warn("LocalStorage pet deadlines error:", err);
    }
  }, [petDeadlines]);

  useEffect(() => {
    try {
      localStorage.setItem('lifetrack_pet_docs', JSON.stringify(petDocs));
    } catch (err) {
      console.warn("LocalStorage pet docs error:", err);
    }
  }, [petDocs]);

  useEffect(() => {
    try {
      localStorage.setItem("lifetrack_sync_enabled", String(syncEnabled));
    } catch (err) {
      console.warn("LocalStorage sync flag error:", err);
    }
  }, [syncEnabled]);

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
        if (d.deleted) return d;
        if (d.autoPay && !d.done && d.date < now) {
          updated = true;
          return { ...d, done: true, autoCompleted: true }; // flag per sapere che è stata auto-completata
        }
        return d;
      });
      
      if (updated) {
        setDeadlines(newDeadlines);
        const count = newDeadlines.filter(d => d.autoCompleted && d.done && !d.deleted).length - deadlines.filter(d => d.autoCompleted && d.done && !d.deleted).length;
        if (count > 0) {
          showToast(t("toast.autoPayCompleted", { count }));
        }
      }
    };
    
    // Esegui al mount e ogni volta che cambiano le deadlines (ma solo se non è un update da auto-complete stesso)
    const timer = setTimeout(autoCompleteDeadlines, 500);
    return () => clearTimeout(timer);
  }, [deadlines.length]); // Dipende solo dalla lunghezza per evitare loop infiniti

  // Rolling recurring series: keep coverage through end of next year
  useEffect(() => {
    if (!user || loading) return;
    if (!deadlines.length) return;

    const horizon = getAutoEndDate();
    const seriesMap = new Map();

    deadlines.forEach(d => {
      if (d?.deleted) return;
      if (!d?.recurring?.enabled) return;
      const endMode = d.recurring.endMode || "auto";
      if (endMode !== "auto") return;
      const seriesId = d.recurring.seriesId;
      if (!seriesId) return;
      if (!seriesMap.has(seriesId)) seriesMap.set(seriesId, []);
      seriesMap.get(seriesId).push(d);
    });

    if (seriesMap.size === 0) return;

    let updated = false;
    let nextDeadlines = deadlines;
    const newItems = [];

    seriesMap.forEach((items, seriesId) => {
      const ordered = items
        .slice()
        .sort((a, b) => (a.recurring?.index || 0) - (b.recurring?.index || 0));
      const last = ordered[ordered.length - 1];
      if (!last || !isValidDate(last.date)) return;
      if (last.date >= horizon) return;

      const interval = last.recurring?.interval || 1;
      const unit = last.recurring?.unit || "mesi";
      const lastIndex = Math.max(...ordered.map(d => d.recurring?.index || 0));
      const template = last;

      const additions = [];
      let guard = 0;
      let step = 1;
      let nextDate = getOccurrenceDate(last.date, step, interval, unit);

      while (nextDate <= horizon && guard < 800) {
        guard += 1;
        const newIndex = lastIndex + additions.length + 1;
        const newId = `${seriesId}_${newIndex}`;
        additions.push({
          ...template,
          id: newId,
          date: nextDate,
          done: false,
          skipped: false,
          documents: [],
          recurring: {
            ...template.recurring,
            index: newIndex,
          }
        });
        step += 1;
        nextDate = getOccurrenceDate(last.date, step, interval, unit);
      }

      if (additions.length > 0) {
        const newTotal = lastIndex + additions.length;
        updated = true;
        nextDeadlines = nextDeadlines.map(d => (
          d.recurring?.seriesId === seriesId
            ? { ...d, recurring: { ...d.recurring, total: newTotal } }
            : d
        ));
        newItems.push(
          ...additions.map(d => ({ ...d, recurring: { ...d.recurring, total: newTotal } }))
        );
      }
    });

    if (updated) {
      setDeadlines([...nextDeadlines, ...newItems]);
    }
  }, [deadlines, user, loading]);

  const [filterCat, setFilterCat] = useState(null);
  const [filterAsset, setFilterAsset] = useState(null);
  const [filterMandatory, setFilterMandatory] = useState(false);
  const [filterRecurring, setFilterRecurring] = useState(false);
  const [filterAutoPay, setFilterAutoPay] = useState(false);
  const [filterManual, setFilterManual] = useState(false);
  const [filterEssential, setFilterEssential] = useState(false);
  const [filterEstimateMissing, setFilterEstimateMissing] = useState(false);
  const [filterPet, setFilterPet] = useState(false);
  const [expandedFilterCat, setExpandedFilterCat] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(null); // For editing existing deadlines
  const [editConfirm, setEditConfirm] = useState(null); // { item, form }
  const [presetAsset, setPresetAsset] = useState(null); // { catId, assetName }
  const [showCats, setShowCats] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [mainSection, setMainSection] = useState("deadlines"); // deadlines | assets | documents
  const [showAsset, setShowAsset] = useState(null); // { cat, asset }
  const [showAssetList, setShowAssetList] = useState(false);
  const [showPetAdd, setShowPetAdd] = useState(false);
  const [activePetId, setActivePetId] = useState(null);
  const [petTab, setPetTab] = useState("overview");
  const [petSearch, setPetSearch] = useState("");
  const [showPetEventModal, setShowPetEventModal] = useState(false);
  const [showPetDeadlineModal, setShowPetDeadlineModal] = useState(false);
  const [showPetDocModal, setShowPetDocModal] = useState(false);
  const [petForm, setPetForm] = useState({ name:"", species:"dog", birth:"", notes:"", photo:"", id:null });
  const [editingPetId, setEditingPetId] = useState(null);
  const [petEventForm, setPetEventForm] = useState({ title:"", date:"", cost:"", notes:"", schedule:false, schedulePreset:"1m", scheduleDate:"" });
  const [petDeadlineForm, setPetDeadlineForm] = useState({ title:"", date:"", cost:"" });
  const [editingPetDeadlineId, setEditingPetDeadlineId] = useState(null);
  const [petEventFiles, setPetEventFiles] = useState([]);
  const [petDocsFiles, setPetDocsFiles] = useState([]);
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

  const triggerManualSync = async () => {
    if (!syncEnabled) {
      showToast(t("toast.syncDisabled"));
      return;
    }
    if (syncing || pendingSaveRef.current) {
      showToast(t("toast.syncBusy"));
      return;
    }
    const now = Date.now();
    if (now - lastManualSyncRef.current < MANUAL_SYNC_COOLDOWN_MS) {
      showToast(t("toast.syncUpToDate"));
      return;
    }
    lastManualSyncRef.current = now;
    showToast(t("toast.syncStarted"));
    if (syncNowRef.current) {
      setPullSyncing(true);
      try {
        await syncNowRef.current("manual");
      } finally {
        setPullSyncing(false);
      }
    }
  };

  const handlePullStart = (e) => {
    if (!listRef.current) return;
    if (listRef.current.scrollTop > 0) return;
    pullActiveRef.current = true;
    pullStartRef.current = e.touches[0].clientY;
    setPulling(true);
  };

  const handlePullMove = (e) => {
    if (!pullActiveRef.current || !listRef.current) return;
    if (listRef.current.scrollTop > 0) return;
    const delta = e.touches[0].clientY - pullStartRef.current;
    if (delta <= 0) return;
    if (e.cancelable) e.preventDefault();
    setPullOffset(Math.min(delta, 80));
  };

  const handlePullEnd = () => {
    if (!pullActiveRef.current) return;
    pullActiveRef.current = false;
    setPulling(false);
    if (pullOffset > 52) {
      triggerManualSync();
    }
    setPullOffset(0);
  };

  const triggerRepairSync = async () => {
    if (!syncEnabled) {
      showToast(t("toast.syncDisabled"));
      return;
    }
    showToast(t("toast.syncStarted"));
    if (syncNowRef.current) {
      await syncNowRef.current("repair");
    }
  };

  const processAttachmentFile = async (file) => {
    const isImage = isImageType(file.type);
    if (isImage) {
      try {
        let blob = await compressImageToBlob(file, { maxWidth: 1600, quality: 0.8 });
        if (blob.size > IMAGE_MAX_BYTES) {
          blob = await compressImageToBlob(file, { maxWidth: 1280, quality: 0.7 });
        }
        if (blob.size > IMAGE_MAX_BYTES) {
          throw new Error("image_too_large");
        }
        return {
          blob,
          contentType: "image/jpeg",
          filename: file.name || "photo.jpg",
          size: blob.size,
          isImage: true
        };
      } catch (err) {
        // Fallback for formats the browser can't decode (e.g. HEIC)
        if (file.size > FILE_MAX_BYTES) throw new Error("file_too_large");
        return {
          blob: file,
          contentType: file.type || "application/octet-stream",
          filename: file.name || "file",
          size: file.size,
          isImage: true
        };
      }
    }
    if (file.size > FILE_MAX_BYTES) {
      throw new Error("file_too_large");
    }
    return {
      blob: file,
      contentType: file.type || "application/octet-stream",
      filename: file.name || "file",
      size: file.size,
      isImage: false
    };
  };

  const uploadAttachments = async (files, { scope, assetKey, workLogId }) => {
    if (!user) {
      showToast(t("toast.loginRequired"));
      return [];
    }
    if (!files?.length) return [];
    if (files.length > MAX_ATTACHMENTS) {
      showToast(t("toast.attachmentsLimit", { count: MAX_ATTACHMENTS }));
      return [];
    }
    const uploaded = [];
    for (const file of files) {
      try {
        const processed = await processAttachmentFile(file);
        const safeName = sanitizeFilename(processed.filename);
        const docId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (!USE_STORAGE) {
          const base64 = processed.isImage
            ? await compressImage(file, 1600)
            : await fileToBase64(file);
          uploaded.push({
            id: docId,
            filename: processed.filename,
            base64,
            contentType: processed.contentType,
            size: processed.size,
            uploadDate: new Date().toISOString(),
            source: scope,
            isImage: processed.isImage
          });
        } else {
          const basePath = scope === "worklog"
            ? `users/${user.uid}/worklogs/${assetKey}/${workLogId}`
            : `users/${user.uid}/assets/${assetKey}`;
          const fullPath = `${basePath}/${docId}_${safeName}`;
          const fileRef = storageRef(storage, fullPath);
          await Promise.race([
            uploadBytes(fileRef, processed.blob, { contentType: processed.contentType }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("upload_timeout")), UPLOAD_TIMEOUT_MS))
          ]);
          const url = await Promise.race([
            getDownloadURL(fileRef),
            new Promise((_, reject) => setTimeout(() => reject(new Error("url_timeout")), 10000))
          ]);
          uploaded.push({
            id: docId,
            filename: processed.filename,
            url,
            contentType: processed.contentType,
            size: processed.size,
            uploadDate: new Date().toISOString(),
            source: scope,
            isImage: processed.isImage
          });
        }
      } catch (err) {
        const code = err?.message || "unknown";
        if (code === "image_too_large") showToast(t("toast.imageTooLarge", { size: 5 }));
        else if (code === "file_too_large") showToast(t("toast.fileTooLarge", { size: 10 }));
        else if (code === "upload_timeout") showToast(t("toast.uploadTimeout"));
        else if (code === "url_timeout") showToast(t("toast.uploadTimeout"));
        else showToast(t("toast.documentUploadError"));
      }
    }
    return uploaded;
  };

  const handleAddAsset = async (catId, name, files = []) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const alreadyExists = cats.find(c => c.id === catId)?.assets?.includes(trimmed);
    setCats(prev => prev.map(c => {
      if (c.id !== catId) return c;
      if (c.assets.includes(trimmed)) return c;
      return { ...c, assets: [...c.assets, trimmed] };
    }));

    if (!alreadyExists && files.length) {
      const assetKey = `${catId}_${trimmed.toLowerCase().replace(/\s+/g, '_')}`;
      const uploaded = await uploadAttachments(files, { scope: "asset", assetKey });
      if (uploaded.length) {
        setAssetDocs(prev => ({
          ...prev,
          [assetKey]: [...(prev[assetKey] || []), ...uploaded]
        }));
        showToast(t("toast.documentAttached"));
      }
    }
  };

  const makeId = () => `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const mergeFiles = (prev, files) => [...prev, ...Array.from(files || [])].slice(0, MAX_ATTACHMENTS);

  const closePetModal = () => {
    setShowPetAdd(false);
    setEditingPetId(null);
    setPetForm({ name:"", species:"dog", birth:"", notes:"", photo:"", id:null });
  };

  const startEditPet = (pet) => {
    if (!pet) return;
    setEditingPetId(pet.id);
    setPetForm({
      name: pet.name || "",
      species: pet.species || "dog",
      birth: pet.birth || "",
      notes: pet.notes || "",
      photo: pet.photo || "",
      id: pet.id
    });
    setShowPetAdd(true);
  };

  const addPet = () => {
    const name = petForm.name.trim();
    if (!name) return;
    if (editingPetId) {
      setPets(prev => prev.map(p => p.id === editingPetId ? {
        ...p,
        name,
        species: petForm.species || "dog",
        birth: petForm.birth || "",
        notes: petForm.notes || "",
        photo: petForm.photo || "",
        updatedAt: new Date().toISOString()
      } : p));
    } else {
      const newPet = {
        id: makeId(),
        name,
        species: petForm.species || "dog",
        birth: petForm.birth || "",
        notes: petForm.notes || "",
        photo: petForm.photo || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setPets(prev => [newPet, ...prev]);
    }
    closePetModal();
  };

  const deletePet = (petId) => {
    if (!window.confirm(t("pet.deleteConfirm"))) return;
    setPets(prev => prev.filter(p => p.id !== petId));
    setPetEvents(prev => prev.filter(e => e.petId !== petId));
    setPetDeadlines(prev => prev.filter(d => d.petId !== petId));
    setPetDocs(prev => prev.filter(d => d.petId !== petId));
    if (activePetId === petId) setActivePetId(null);
  };

  const addPetEvent = async () => {
    if (!activePetId) return;
    const title = petEventForm.title.trim();
    if (!title || !petEventForm.date) return;
    let attachments = [];
    if (petEventFiles.length) {
      attachments = await uploadAttachments(petEventFiles, { scope:"petEvent", petId: activePetId });
    }
    const event = {
      id: makeId(),
      petId: activePetId,
      title,
      date: petEventForm.date,
      cost: Number(petEventForm.cost) || 0,
      notes: petEventForm.notes || "",
      attachments,
      createdAt: new Date().toISOString()
    };
    setPetEvents(prev => [event, ...prev]);

    if (petEventForm.schedule) {
      let nextDate = "";
      if (petEventForm.schedulePreset === "exact") nextDate = petEventForm.scheduleDate;
      if (petEventForm.schedulePreset === "1m") nextDate = addMonths(new Date(petEventForm.date), 1).toISOString().split("T")[0];
      if (petEventForm.schedulePreset === "6m") nextDate = addMonths(new Date(petEventForm.date), 6).toISOString().split("T")[0];
      if (petEventForm.schedulePreset === "12m") nextDate = addMonths(new Date(petEventForm.date), 12).toISOString().split("T")[0];
      if (nextDate) {
        const deadline = {
          id: makeId(),
          petId: activePetId,
          title: title,
          date: nextDate,
          cost: Number(petEventForm.cost) || 0,
          createdAt: new Date().toISOString()
        };
        setPetDeadlines(prev => [deadline, ...prev]);
      }
    }

    setPetEventForm({ title:"", date:"", cost:"", notes:"", schedule:false, schedulePreset:"1m", scheduleDate:"" });
    setPetEventFiles([]);
    setShowPetEventModal(false);
  };

  const closePetDeadlineModal = () => {
    setShowPetDeadlineModal(false);
    setEditingPetDeadlineId(null);
    setPetDeadlineForm({ title:"", date:"", cost:"" });
  };

  const startEditPetDeadline = (item) => {
    if (!item) return;
    const dateStr = item.date instanceof Date
      ? item.date.toISOString().split("T")[0]
      : item.date || "";
    setEditingPetDeadlineId(String(item.id));
    setPetDeadlineForm({
      title: item.title || "",
      date: dateStr,
      cost: Number(item.budget ?? item.cost ?? 0) || ""
    });
    setShowPetDeadlineModal(true);
  };

  const addPetDeadline = () => {
    const title = petDeadlineForm.title.trim();
    if (!title || !petDeadlineForm.date) return;
    if (editingPetDeadlineId) {
      setPetDeadlines(prev => prev.map(d => String(d.id) === String(editingPetDeadlineId) ? {
        ...d,
        title,
        date: petDeadlineForm.date,
        cost: Number(petDeadlineForm.cost) || 0,
        updatedAt: new Date().toISOString()
      } : d));
    } else {
      if (!activePetId) return;
      const deadline = {
        id: makeId(),
        petId: activePetId,
        title,
        date: petDeadlineForm.date,
        cost: Number(petDeadlineForm.cost) || 0,
        createdAt: new Date().toISOString()
      };
      setPetDeadlines(prev => [deadline, ...prev]);
    }
    closePetDeadlineModal();
  };

  const addPetDocs = async () => {
    if (!activePetId || !petDocsFiles.length) return;
    const uploaded = await uploadAttachments(petDocsFiles, { scope:"petDoc", petId: activePetId });
    if (uploaded.length) {
      const docs = uploaded.map(d => ({ ...d, petId: activePetId }));
      setPetDocs(prev => [...docs, ...prev]);
      showToast(t("toast.documentAttached"));
    }
    setPetDocsFiles([]);
    setShowPetDocModal(false);
  };

  const resetCloudData = async () => {
    if (!user) return;
    if (!window.confirm(t("backup.resetCloudConfirm"))) return;
    try {
      startSync();
      localStorage.removeItem('lifetrack_categories');
      localStorage.removeItem('lifetrack_deadlines');
      localStorage.removeItem('lifetrack_deadlines_version');
      localStorage.removeItem('lifetrack_worklogs');
      localStorage.removeItem('lifetrack_asset_docs');
      localStorage.removeItem('lifetrack_pets');
      localStorage.removeItem('lifetrack_pet_events');
      localStorage.removeItem('lifetrack_pet_deadlines');
      localStorage.removeItem('lifetrack_pet_docs');
      suppressDeadlinesRef.current = true;
      suppressMetaRef.current = true;
      deadlinesVersionRef.current = 0;
      setDeadlines([]);
      setCats(DEFAULT_CATS);
      setWorkLogs({});
      setAssetDocs({});
      setPets([]);
      setPetEvents([]);
      setPetDeadlines([]);
      setPetDocs([]);
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
        assetDocs: {},
        pets: [],
        petEvents: [],
        petDeadlines: [],
        petDocs: [],
        deadlines: [],
        deadlinesVersion: 0,
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

  const queuePendingDelete = (ids) => {
    ids.forEach(id => pendingDeleteRef.current.add(String(id)));
  };

  const clearPendingDelete = (ids) => {
    ids.forEach(id => pendingDeleteRef.current.delete(String(id)));
  };

  const deleteDeadlinesRemote = async (ids, stamp) => {
    if (!user || ids.length === 0) return;
    const now = stamp || Date.now();
    startSync();
    try {
      const chunkSize = 400;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const batch = writeBatch(db);
        ids.slice(i, i + chunkSize).forEach(id => {
          batch.set(
            doc(db, 'users', user.uid, 'deadlines', String(id)),
            { deleted: true, deletedAt: now, updatedAt: now },
            { merge: true }
          );
        });
        await batch.commit();
      }
      await setDoc(doc(db, 'users', user.uid), {
        deadlinesVersion: now,
        lastUpdate: new Date().toISOString()
      }, { merge: true });
      deadlinesVersionRef.current = now;
      try { localStorage.setItem("lifetrack_deadlines_version", String(now)); } catch (err) {}
      clearPendingDelete(ids);
    } catch (error) {
      console.error("Firebase delete error:", error);
      showToast(t("toast.deleteSyncError", { code: error?.code || "unknown" }));
    } finally {
      endSync();
    }
  };

  const period = useMemo(() => getPeriodRange(range, periodOffset), [range, periodOffset]);
  const periodStart = period.start;
  const periodEnd = period.end;
  const periodLabel = useMemo(() => {
    const locale = getLocale();
    const isIt = locale.startsWith("it");
    if (range === "settimana") {
      const startStr = periodStart.toLocaleDateString(locale, { day:"2-digit", month:"short" });
      const endStr = periodEnd.toLocaleDateString(locale, { day:"2-digit", month:"short", year:"numeric" });
      return isIt ? `Settimana ${startStr}–${endStr}` : `Week ${startStr}–${endStr}`;
    }
    if (range === "mese") {
      return capitalize(periodStart.toLocaleDateString(locale, { month:"long", year:"numeric" }));
    }
    if (range === "trimestre") {
      return `Q${(period.quarter ?? 0) + 1} ${period.year}`;
    }
    if (range === "semestre") {
      const half = period.half ?? 0;
      return half === 0
        ? t("group.semesterFirst", { year: period.year, defaultValue: `1° semestre ${period.year}` })
        : t("group.semesterSecond", { year: period.year, defaultValue: `2° semestre ${period.year}` });
    }
    return String(period.year);
  }, [range, periodStart, periodEnd, period.year, period.quarter, period.half, t, i18n.language]);

  const petDeadlineIds = useMemo(() => new Set(petDeadlines.map(d => String(d.id))), [petDeadlines]);
  const petDeadlineItems = useMemo(() => {
    const petMap = new Map(pets.map(p => [p.id, p.name]));
    return petDeadlines.map(d => {
      const rawDate = d.date instanceof Date ? d.date : new Date(`${d.date}T00:00:00`);
      if (!rawDate || Number.isNaN(rawDate.getTime())) return null;
      return {
        id: String(d.id),
        title: d.title || t("pet.deadlines"),
        cat: "pet",
        asset: petMap.get(d.petId) || t("pet.title"),
        petId: d.petId,
        date: rawDate,
        budget: Number(d.cost) || 0,
        estimateMissing: d.skipped ? false : !(Number(d.cost) > 0),
        notes: d.notes || "",
        recurring: d.recurring || null,
        mandatory: false,
        autoPay: false,
        essential: false,
        documents: d.documents || [],
        done: !!d.done,
        skipped: !!d.skipped
      };
    }).filter(Boolean);
  }, [petDeadlines, pets, t]);
  const activeDeadlines = useMemo(() => deadlines.filter(d => !d?.deleted), [deadlines]);
  const allDeadlines = useMemo(() => [...activeDeadlines, ...petDeadlineItems], [activeDeadlines, petDeadlineItems]);

  const filtered = useMemo(() => {
    let list = allDeadlines.filter(d => {
      if (activeTab === "done") return d.done;
      if (activeTab === "overdue") return d.date < TODAY && !d.done; // scadute non completate
      if (activeTab === "timeline") return d.date >= periodStart && d.date <= periodEnd && !d.done;
      return true;
    });
    if (filterCat) list = list.filter(d => d.cat === filterCat);
    if (filterAsset) list = list.filter(d => d.asset === filterAsset);
    if (filterMandatory) list = list.filter(d => d.mandatory);
    if (filterRecurring) list = list.filter(d => d.recurring && d.recurring.enabled);
    if (filterAutoPay) list = list.filter(d => d.autoPay);
    if (filterManual) list = list.filter(d => !d.autoPay);
    if (filterEssential) list = list.filter(d => d.essential);
    if (filterEstimateMissing) list = list.filter(d => d.estimateMissing);
    if (filterPet) list = list.filter(d => d.petId);
    list.sort((a, b) => a.date - b.date);
    return list;
  }, [allDeadlines, range, filterCat, filterAsset, filterMandatory, filterRecurring, filterAutoPay, filterEssential, filterEstimateMissing, filterPet, activeTab, periodStart, periodEnd]);

  const groups = useMemo(() => groupItems(filtered, range), [filtered, range]);
  const baseYear = TODAY.getFullYear();
  const baseMonthIndex = TODAY.getFullYear() * 12 + TODAY.getMonth();
  const navCandidates = useMemo(() => {
    let list = allDeadlines.filter(d => {
      if (activeTab === "done") return d.done;
      if (activeTab === "overdue") return d.date < TODAY && !d.done;
      if (activeTab === "timeline") return !d.done;
      return true;
    });
    if (filterCat) list = list.filter(d => d.cat === filterCat);
    if (filterAsset) list = list.filter(d => d.asset === filterAsset);
    if (filterMandatory) list = list.filter(d => d.mandatory);
    if (filterRecurring) list = list.filter(d => d.recurring && d.recurring.enabled);
    if (filterAutoPay) list = list.filter(d => d.autoPay);
    if (filterManual) list = list.filter(d => !d.autoPay);
    if (filterEssential) list = list.filter(d => d.essential);
    if (filterEstimateMissing) list = list.filter(d => d.estimateMissing);
    if (filterPet) list = list.filter(d => d.petId);
    return list;
  }, [allDeadlines, activeTab, filterCat, filterAsset, filterMandatory, filterRecurring, filterAutoPay, filterManual, filterEssential, filterEstimateMissing, filterPet]);
  const availableYears = useMemo(() => {
    const years = new Set();
    navCandidates.forEach(d => {
      if (d?.date instanceof Date && !Number.isNaN(d.date.getTime())) years.add(d.date.getFullYear());
    });
    return Array.from(years).sort((a, b) => a - b);
  }, [navCandidates]);
  const availableMonths = useMemo(() => {
    const months = new Set();
    navCandidates.forEach(d => {
      if (d?.date instanceof Date && !Number.isNaN(d.date.getTime())) {
        months.add(d.date.getFullYear() * 12 + d.date.getMonth());
      }
    });
    return Array.from(months).sort((a, b) => a - b);
  }, [navCandidates]);
  const isYearCompact = range === "anno";
  const isMonthView = range === "mese";
  const prevYear = useMemo(() => {
    if (!isYearCompact || availableYears.length === 0) return null;
    const current = period.year;
    const prev = availableYears.filter(y => y < current).pop();
    return typeof prev === "number" ? prev : null;
  }, [isYearCompact, availableYears, period.year]);
  const nextYear = useMemo(() => {
    if (!isYearCompact || availableYears.length === 0) return null;
    const current = period.year;
    const next = availableYears.find(y => y > current);
    return typeof next === "number" ? next : null;
  }, [isYearCompact, availableYears, period.year]);
  const canPrevYear = isYearCompact && prevYear !== null;
  const canNextYear = isYearCompact && nextYear !== null;
  const prevMonth = useMemo(() => {
    if (!isMonthView || availableMonths.length === 0) return null;
    const current = period.year * 12 + (period.month ?? 0);
    const prev = availableMonths.filter(m => m < current).pop();
    return typeof prev === "number" ? prev : null;
  }, [isMonthView, availableMonths, period.year, period.month]);
  const nextMonth = useMemo(() => {
    if (!isMonthView || availableMonths.length === 0) return null;
    const current = period.year * 12 + (period.month ?? 0);
    const next = availableMonths.find(m => m > current);
    return typeof next === "number" ? next : null;
  }, [isMonthView, availableMonths, period.year, period.month]);
  const canPrevMonth = isMonthView && prevMonth !== null;
  const canNextMonth = isMonthView && nextMonth !== null;
  const yearDetailLimit = 6;
  const mandatoryItems = useMemo(() => {
    if (!isYearCompact) return [];
    return filtered.filter(d => d.mandatory).sort((a, b) => a.date - b.date);
  }, [filtered, isYearCompact]);

  const oneOffItems = useMemo(() => {
    if (!isYearCompact) return [];
    return filtered.filter(d => !d.mandatory && !d?.recurring?.enabled).sort((a, b) => a.date - b.date);
  }, [filtered, isYearCompact]);

  const recurringSummary = useMemo(() => {
    if (!isYearCompact) return [];
    const map = new Map();
    filtered.forEach(item => {
      if (!item?.recurring?.enabled) return;
      if (item.mandatory) return;
      const seriesId = item.recurring.seriesId || String(item.id);
      if (!map.has(seriesId)) map.set(seriesId, []);
      map.get(seriesId).push(item);
    });
    const locale = getLocale();
    const isIt = locale.startsWith("it");
    const singular = { giorni:"giorno", settimane:"settimana", mesi:"mese", anni:"anno", days:"day", weeks:"week", months:"month", years:"year" };
    const plural = { giorni:"giorni", settimane:"settimane", mesi:"mesi", anni:"anni", days:"days", weeks:"weeks", months:"months", years:"years" };
    const unitLabel = (unit, count) => {
      const key = count === 1 ? singular[unit] : plural[unit];
      return key || unit;
    };
    const frequencyLabel = (interval, unit) => {
      const safeInterval = Math.max(1, parseInt(interval) || 1);
      const label = unitLabel(unit, safeInterval);
      return isIt ? `Ogni ${safeInterval} ${label}` : `Every ${safeInterval} ${label}`;
    };
    return Array.from(map.values()).map(items => {
      const ordered = items.slice().sort((a, b) => a.date - b.date);
      const sample = ordered[0];
      const knownTotal = ordered.filter(d => !d.estimateMissing).reduce((s, d) => s + (Number(d.budget) || 0), 0);
      const missingCount = ordered.filter(d => d.estimateMissing).length;
      const nextItem = ordered.find(d => d.date >= TODAY) || ordered[0];
      return {
        id: sample.recurring.seriesId || String(sample.id),
        title: sample.title,
        cat: sample.cat,
        asset: sample.asset,
        autoPay: sample.autoPay,
        mandatory: sample.mandatory,
        essential: sample.essential,
        frequency: frequencyLabel(sample.recurring.interval, sample.recurring.unit),
        count: ordered.length,
        knownTotal,
        missingCount,
        nextDate: nextItem?.date,
      };
    }).sort((a, b) => (a.nextDate?.getTime?.() || 0) - (b.nextDate?.getTime?.() || 0));
  }, [filtered, isYearCompact, i18n.language]);
  const recurringAuto = useMemo(() => recurringSummary.filter(item => item.autoPay), [recurringSummary]);
  const recurringManual = useMemo(() => recurringSummary.filter(item => !item.autoPay), [recurringSummary]);

  useEffect(() => {
    if (!isYearCompact) {
      setShowAllMandatory(false);
      setShowAllOneOff(false);
    }
  }, [isYearCompact]);

  const toggle   = id => setExpandedId(prev => prev === id ? null : id);
  const handleEditItem = (item) => {
    if (petDeadlineIds.has(String(item.id))) {
      startEditPetDeadline(item);
      return;
    }
    setEditingDeadline(item);
    setShowAdd(true);
  };
  
  const complete = id => {
    if (petDeadlineIds.has(String(id))) {
      setPetDeadlines(p => p.map(d => String(d.id) === String(id)
        ? { ...d, done: !d.done, skipped: d.done ? false : d.skipped }
        : d
      ));
      setExpandedId(null);
      return;
    }
    const item = activeDeadlines.find(d => d.id === id);
    if (!item) return;
    
    if (item.done) {
      setDeadlines(p => p.map(d => d.id === id ? { ...d, done: false, skipped: false } : d));
      setExpandedId(null);
      return;
    }

    // Se ha budget > 0 e non è già completata, apri il flow di pagamento
    if (item.budget > 0) {
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
    if (petDeadlineIds.has(String(id))) {
      const item = petDeadlines.find(d => String(d.id) === String(id));
      if (item?.recurring?.enabled && !window.confirm(t("confirm.skipNonDue"))) return;
      setPetDeadlines(p => p.map(d => String(d.id) === String(id)
        ? { ...d, done: true, skipped: true, cost: 0 }
        : d
      ));
      setExpandedId(null);
      showToast(t("toast.deadlineSkipped"));
      return;
    }
    const item = activeDeadlines.find(d => d.id === id);
    if (!item || item.done) return;
    if (item.recurring?.enabled && !window.confirm(t("confirm.skipNonDue"))) return;
    setDeadlines(p => p.map(d => d.id === id ? {
      ...d,
      done: true,
      skipped: true,
      budget: 0,
      estimateMissing: false
    } : d));
    setExpandedId(null);
    showToast(t("toast.deadlineSkipped"));
  };
  
  const confirmPayment = (type) => {
    const item = activeDeadlines.find(d => d.id === paymentFlow.itemId);
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
  
  const markDeadlinesDeleted = (ids) => {
    if (!ids.length) return;
    const now = Date.now();
    const idSet = new Set(ids.map(id => String(id)));
    suppressDeadlinesRef.current = true;
    setDeadlines(p => p.filter(d => !idSet.has(String(d.id))));
    queuePendingDelete(ids);
    deleteDeadlinesRemote(ids, now);
  };

  const del = id => {
    if (petDeadlineIds.has(String(id))) {
      setPetDeadlines(p => p.filter(d => String(d.id) !== String(id)));
      setExpandedId(null);
      showToast(t("toast.deadlineDeleted"));
      return;
    }
    const item = activeDeadlines.find(d => d.id === id);
    if (!item) return;
    
    // Se fa parte di una serie, mostra modal conferma
    if (item.recurring && item.recurring.enabled && item.recurring.total > 1) {
      const seriesId = item.recurring.seriesId;
      const currentIndex = item.recurring.index;
      
      // Trova tutte le occorrenze della serie
      const seriesItems = activeDeadlines.filter(d => d.recurring && d.recurring.seriesId === seriesId);
      
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
        const idsToDelete = [id];
        markDeadlinesDeleted(idsToDelete);
        setExpandedId(null);
        showToast(t("toast.deadlineDeleted"));
      }
    } else {
      // Non fa parte di una serie, elimina direttamente
      const idsToDelete = [id];
      markDeadlinesDeleted(idsToDelete);
      setExpandedId(null);
      showToast(t("toast.deadlineDeleted"));
    }
  };
  
  const confirmDelete = () => {
    if (!deleteConfirm) return;
    
    // Elimina questa + tutte le future
    const idsToDelete = activeDeadlines
      .filter(d => d.recurring && d.recurring.seriesId === deleteConfirm.seriesId && d.recurring.index >= deleteConfirm.currentIndex)
      .map(d => d.id);
    const now = Date.now();
    const seriesId = deleteConfirm.seriesId;
    const cutoffIndex = deleteConfirm.currentIndex;
    setDeadlines(p => {
      const updated = p.map(d => {
        if (!d?.recurring || d.recurring.seriesId !== seriesId) return d;
        if ((d.recurring.index || 0) >= cutoffIndex) return d;
        const endDate = d.date instanceof Date ? d.date.toISOString().split('T')[0] : d.date;
        return {
          ...d,
          recurring: {
            ...d.recurring,
            endMode: "date",
            endDate,
            total: cutoffIndex - 1
          }
        };
      });
      const idSet = new Set(idsToDelete.map(id => String(id)));
      return updated.filter(d => !idSet.has(String(d.id)));
    });
    queuePendingDelete(idsToDelete);
    deleteDeadlinesRemote(idsToDelete, now);
    setExpandedId(null);
    showToast(t("toast.futureDeleted", { count: deleteConfirm.futureCount }));
    setDeleteConfirm(null);
  };
  const add = items => { 
    const itemsArray = Array.isArray(items) ? items : [items];
    setDeadlines(p => [...p, ...itemsArray]); 
    
    // Check if any deadline is outside current range
    const outsideRange = itemsArray.filter(item => item.date < periodStart || item.date > periodEnd);
    if (outsideRange.length > 0) {
      const rangeLabel = periodLabel;
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
      if (petDeadlineIds.has(String(postponeId))) {
        setPetDeadlines(p => p.map(d => String(d.id) === String(postponeId) ? { ...d, date: postponeDate } : d));
      } else {
        setDeadlines(p => p.map(d => d.id === postponeId ? { ...d, date: new Date(postponeDate + "T00:00:00") } : d));
      }
      showToast(t("toast.deadlinePostponed"));
    }
    setPostponeId(null);
    setPostponeDate("");
    setExpandedId(null);
  };
  
  // Upload document to deadline
  const handleDocumentUpload = async (deadlineId, type, file) => {
    try {
      const processed = await processAttachmentFile(file);
      const base64 = processed.isImage
        ? await compressImage(file, 1600)
        : await fileToBase64(file);
      const doc = {
        id: Date.now(),
        type, // 'incoming' or 'receipt'
        base64,
        filename: processed.filename,
        contentType: processed.contentType,
        size: processed.size,
        isImage: processed.isImage,
        uploadDate: new Date().toISOString()
      };
      setDeadlines(p => p.map(d => d.id === deadlineId ? { ...d, documents: [...(d.documents || []), doc] } : d));
      showToast(t("toast.documentAttached"));
    } catch(err) {
      const code = err?.message || "unknown";
      if (code === "image_too_large") showToast(t("toast.imageTooLarge", { size: 5 }));
      else if (code === "file_too_large") showToast(t("toast.fileTooLarge", { size: 10 }));
      else showToast(t("toast.documentUploadError"));
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
      const source = doc.url || doc.base64;
      const response = await fetch(source);
      const blob = await response.blob();
      const file = new File([blob], doc.filename || defaultFilename, { type: blob.type || "image/jpeg" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        await navigator.share({ title: doc.filename || defaultTitle, url: source });
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
        input[type="date"]{
          background-image:none;
          padding-right:12px;
          min-width:0;
        }
        input[type="date"]::-webkit-calendar-picker-indicator{
          opacity:1;
          display:block;
        }
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
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {(pullOffset > 0 || pullSyncing) && (
        <div style={{
          position:"fixed", top:0, left:0, right:0,
          height: Math.max(pullOffset, pullSyncing ? 32 : 0),
          display:"flex", alignItems:"flex-end", justifyContent:"center",
          paddingBottom:6, zIndex:110, pointerEvents:"none",
          color:"#8a877f", fontSize:11, fontWeight:700, letterSpacing:".3px", textTransform:"uppercase"
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{
              width:16, height:16, borderRadius:"50%",
              border:"2px solid rgba(138,135,127,.3)",
              borderTopColor:"#8a877f",
              animation:"spin .8s linear infinite"
            }}/>
            <span>
              {pullSyncing ? t("sync.saving") : (pullOffset > 52 ? t("sync.releaseToSync") : t("sync.pullToSync"))}
            </span>
          </div>
        </div>
      )}

      {/* HEADER - primary section */}
      <div style={{ position:"sticky", top:0, zIndex:100, background:"#1e1c18" }}>
        <div style={{ 
          background:"#1e1c18", color:"#fff", padding:"8px 16px", position:"relative", overflow:"hidden",
        }}>
          <div style={{ position:"absolute", top:-24, right:-16, width:70, height:70, borderRadius:"50%", background:"rgba(232,133,93,.15)" }}/>
          <div style={{ position:"relative", zIndex:1 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <h1 style={{ margin:0, fontSize:16, fontWeight:800, letterSpacing:"-.4px" }}>
                  {mainSection === "deadlines" ? t("nav.deadlines") : mainSection === "assets" ? t("nav.assets") : t("nav.documents")}
                </h1>
                <span style={{ fontSize:9, opacity:.35 }}>{t("app.tagline")}</span>
              </div>
              <button onClick={() => setShowMenu(true)} style={{ width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", border:"none" }}>
                <span style={{ fontSize:16, color:"rgba(255,255,255,.7)" }}>☰</span>
              </button>
            </div>
          </div>
        </div>

        {/* Budget bar only in deadlines */}
        {mainSection === "deadlines" && (
          <div style={{ background:"#1e1c18" }}>
            <BudgetBar deadlines={allDeadlines} periodStart={periodStart} periodEnd={periodEnd} cats={cats} activeTab={activeTab}/>
          </div>
        )}
      </div>

      {mainSection === "deadlines" && (
        <div
          onTouchStart={handlePullStart}
          onTouchMove={handlePullMove}
          onTouchEnd={handlePullEnd}
          style={{ display:"flex", flexDirection:"column", flex:1 }}
        >
          {/* TAB: Timeline / Scadute / Completate */}
          <div style={{ display:"flex", gap:0, background:"#fff", borderBottom:"1px solid #edecea", position:"sticky", top:0, zIndex:50 }}>
            {[
              { id:"timeline", labelKey:"tabs.timeline" }, 
              { id:"overdue", labelKey:"tabs.overdue" },
              { id:"done", labelKey:"tabs.done" }
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                flex:1, padding:"8px 0", border:"none", background:"transparent", cursor:"pointer",
                fontSize:13, fontWeight: activeTab === tab.id ? 700 : 500,
                color: activeTab === tab.id ? (tab.id === "overdue" ? "#E53935" : "#2d2b26") : "#8a877f",
                borderBottom: activeTab === tab.id ? `2.5px solid ${tab.id === "overdue" ? "#E53935" : "#2d2b26"}` : "2.5px solid transparent",
                transition:"all .2s", minHeight:40,
              }}>{t(tab.labelKey)}</button>
            ))}
          </div>

          {/* Period navigator (above list) */}
          <div style={{ padding:"6px 14px 4px", background:"#f5f4f0" }}>
            <div style={{
              background:"#fff", borderRadius:16, border:"1px solid #edecea",
              padding:"8px 10px", display:"flex", flexDirection:"column", gap:6,
              boxShadow:"0 3px 10px rgba(0,0,0,.05)"
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <button
                  onClick={() => {
                    if (isYearCompact) {
                      if (canPrevYear) setPeriodOffset(prevYear - baseYear);
                      return;
                    }
                    if (isMonthView) {
                      if (canPrevMonth) setPeriodOffset(prevMonth - baseMonthIndex);
                      return;
                    }
                    setPeriodOffset(o => o - 1);
                  }}
                  disabled={(isYearCompact && !canPrevYear) || (isMonthView && !canPrevMonth)}
                  style={{
                    width:32, height:32, borderRadius:"50%", border:"1px solid #e8e6e0",
                    cursor: (isYearCompact && !canPrevYear) || (isMonthView && !canPrevMonth) ? "not-allowed" : "pointer",
                    background:"#faf9f7", color:"#2d2b26", fontSize:16, fontWeight:800,
                    opacity: (isYearCompact && !canPrevYear) || (isMonthView && !canPrevMonth) ? 0.35 : 1
                  }}
                >‹</button>
                <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"space-between", gap:6 }}>
                  <button
                    onClick={() => { setRange("mese"); setPeriodOffset(0); setExpandedId(null); }}
                    style={{
                      background:"transparent", border:"none", cursor:"pointer",
                      fontSize:10, fontWeight: range === "mese" ? 800 : 600,
                      color: range === "mese" ? "#2d2b26" : "#b2afa7",
                      padding:"2px 4px", borderBottom: range === "mese" ? "2px solid #2d2b26" : "2px solid transparent",
                      letterSpacing:".2px", textTransform:"uppercase"
                    }}
                  >
                    {t("range.month", { defaultValue:"Mese" })}
                  </button>
                  <div style={{ flex:1, textAlign:"center" }}>
                    <div style={{ fontSize:16, fontWeight:800, color:"#2d2b26", letterSpacing:"-.2px" }}>{periodLabel}</div>
                  </div>
                  <button
                    onClick={() => { setRange("anno"); setPeriodOffset(0); setExpandedId(null); }}
                    style={{
                      background:"transparent", border:"none", cursor:"pointer",
                      fontSize:10, fontWeight: range === "anno" ? 800 : 600,
                      color: range === "anno" ? "#2d2b26" : "#b2afa7",
                      padding:"2px 4px", borderBottom: range === "anno" ? "2px solid #2d2b26" : "2px solid transparent",
                      letterSpacing:".2px", textTransform:"uppercase"
                    }}
                  >
                    {t("range.year", { defaultValue:"Anno" })}
                  </button>
                </div>
                <button
                  onClick={() => {
                    if (isYearCompact) {
                      if (canNextYear) setPeriodOffset(nextYear - baseYear);
                      return;
                    }
                    if (isMonthView) {
                      if (canNextMonth) setPeriodOffset(nextMonth - baseMonthIndex);
                      return;
                    }
                    setPeriodOffset(o => o + 1);
                  }}
                  disabled={(isYearCompact && !canNextYear) || (isMonthView && !canNextMonth)}
                  style={{
                    width:32, height:32, borderRadius:"50%", border:"1px solid #e8e6e0",
                    cursor: (isYearCompact && !canNextYear) || (isMonthView && !canNextMonth) ? "not-allowed" : "pointer",
                    background:"#faf9f7", color:"#2d2b26", fontSize:16, fontWeight:800,
                    opacity: (isYearCompact && !canNextYear) || (isMonthView && !canNextMonth) ? 0.35 : 1
                  }}
                >›</button>
              </div>
            </div>
          </div>

          {/* LISTA */}
          <div
            ref={listRef}
            style={{ flex:1, overflowY:"auto", padding:"0 18px", paddingBottom:90 }}
          >
            <div
              style={{
                height: pullOffset,
                transition: pulling ? "none" : "height 180ms ease",
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                color:"#8a877f",
                fontSize:11,
                fontWeight:700,
                letterSpacing:".3px",
                textTransform:"uppercase"
              }}
            >
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {(pullOffset > 10 || syncing || pullSyncing) && (
                  <div style={{
                    width:16, height:16, borderRadius:"50%",
                    border:"2px solid rgba(138,135,127,.3)",
                    borderTopColor:"#8a877f",
                    animation:"spin .8s linear infinite"
                  }}/>
                )}
                <span>
                  {(syncing || pullSyncing)
                    ? t("sync.saving")
                    : (pullOffset > 20 ? (pullOffset > 52 ? t("sync.releaseToSync") : t("sync.pullToSync")) : "")}
                </span>
              </div>
            </div>
            {isYearCompact ? (
              (recurringSummary.length === 0 && oneOffItems.length === 0 && mandatoryItems.length === 0) ? (
                <div style={{ textAlign:"center", padding:"60px 20px", color:"#b5b2a8" }}>
                  <div style={{ fontSize:36, marginBottom:10 }}>📅</div>
                  <div style={{ fontSize:15, fontWeight:600, color:"#8a877f" }}>
                    {activeTab === "done" ? t("empty.doneTitle") : t("empty.timelineTitle")}
                  </div>
                  <div style={{ fontSize:13, marginTop:4 }}>
                    {t("empty.hint")} · {periodLabel}
                  </div>
                </div>
              ) : (
                <div style={{ paddingTop:8 }}>
                  <div style={{ marginBottom:10, color:"#8a877f", fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>
                    {t("year.mandatoryTitle", { defaultValue:"Inderogabili" })}
                  </div>
                  {mandatoryItems.length === 0 ? (
                    <div style={{ color:"#b5b2a8", fontSize:13, marginBottom:16 }}>
                      {t("year.mandatoryEmpty", { defaultValue:"Nessuna inderogabile nel periodo." })}
                    </div>
                  ) : (
                    <>
                      {(showAllMandatory ? mandatoryItems : mandatoryItems.slice(0, yearDetailLimit)).map(item => (
                        <DeadlineCard
                          key={item.id}
                          item={item}
                          expanded={expandedId === item.id}
                          onToggle={() => toggle(item.id)}
                          onComplete={() => complete(item.id)}
                          onSkip={() => skip(item.id)}
                          onDelete={() => del(item.id)}
                          onPostpone={() => postpone(item.id)}
                          onEdit={handleEditItem}
                          onUploadDoc={handleDocumentUpload}
                          onDeleteDoc={deleteDocument}
                          onViewDoc={setViewingDoc}
                          onAssetClick={(cat, asset) => setShowAsset({ cat, asset })}
                          cats={cats}
                        />
                      ))}
                      {mandatoryItems.length > yearDetailLimit && !showAllMandatory && (
                        <button onClick={() => setShowAllMandatory(true)} style={{
                          background:"transparent", border:"none", cursor:"pointer", color:"#6b6961",
                          fontSize:12, fontWeight:700, padding:"6px 0"
                        }}>
                          {t("year.showMore", { defaultValue:`Mostra altre ${mandatoryItems.length - yearDetailLimit}` })}
                        </button>
                      )}
                    </>
                  )}

                  <div style={{ margin:"18px 0 10px", color:"#8a877f", fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>
                    {t("year.oneOffTitle", { defaultValue:"Una‑tantum" })}
                  </div>
                  {oneOffItems.length === 0 ? (
                    <div style={{ color:"#b5b2a8", fontSize:13 }}>
                      {t("year.oneOffEmpty", { defaultValue:"Nessuna una‑tantum nel periodo." })}
                    </div>
                  ) : (
                    <>
                      {(showAllOneOff ? oneOffItems : oneOffItems.slice(0, yearDetailLimit)).map(item => (
                        <DeadlineCard
                          key={item.id}
                          item={item}
                          expanded={expandedId === item.id}
                          onToggle={() => toggle(item.id)}
                          onComplete={() => complete(item.id)}
                          onSkip={() => skip(item.id)}
                          onDelete={() => del(item.id)}
                          onPostpone={() => postpone(item.id)}
                          onEdit={handleEditItem}
                          onUploadDoc={handleDocumentUpload}
                          onDeleteDoc={deleteDocument}
                          onViewDoc={setViewingDoc}
                          onAssetClick={(cat, asset) => setShowAsset({ cat, asset })}
                          cats={cats}
                        />
                      ))}
                      {oneOffItems.length > yearDetailLimit && !showAllOneOff && (
                        <button onClick={() => setShowAllOneOff(true)} style={{
                          background:"transparent", border:"none", cursor:"pointer", color:"#6b6961",
                          fontSize:12, fontWeight:700, padding:"6px 0"
                        }}>
                          {t("year.showMore", { defaultValue:`Mostra altre ${oneOffItems.length - yearDetailLimit}` })}
                        </button>
                      )}
                    </>
                  )}

                  <div style={{ margin:"18px 0 10px", color:"#8a877f", fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>
                    {t("year.recurringTitle", { defaultValue:"Ricorrenti" })}
                  </div>
                  {recurringSummary.length === 0 ? (
                    <div style={{ color:"#b5b2a8", fontSize:13, marginBottom:16 }}>
                      {t("year.recurringEmpty", { defaultValue:"Nessuna ricorrente nel periodo." })}
                    </div>
                  ) : (
                    <>
                      {recurringAuto.length > 0 && recurringManual.length > 0 && (
                        <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase", letterSpacing:".4px", marginBottom:6 }}>
                          {t("year.recurringManual", { defaultValue:"Da pagare" })}
                        </div>
                      )}
                      {recurringManual.map(item => (
                        <div key={item.id} style={{
                          background:"#fff", borderRadius:16, border:"1px solid #edecea",
                          padding:"12px 14px", marginBottom:10, boxShadow:"0 2px 8px rgba(0,0,0,.03)"
                        }}>
                          <div style={{ display:"flex", justifyContent:"space-between", gap:12 }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:14, fontWeight:800, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                {item.title}
                              </div>
                              <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>
                                {item.frequency} · {t("year.occurrences", { count: item.count, defaultValue: `${item.count} occ.` })}
                              </div>
                              {item.nextDate && (
                                <div style={{ fontSize:11, color:"#b2afa7", marginTop:2 }}>
                                  {t("year.next", { defaultValue:"Prossima" })}: {fmtDate(item.nextDate)}
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign:"right" }}>
                              <div style={{ fontSize:15, fontWeight:800, color:"#2d2b26" }}>
                                {formatCurrency(item.knownTotal)}
                              </div>
                              <div style={{ fontSize:10, color:"#b2afa7", textTransform:"uppercase", letterSpacing:".4px" }}>
                                {t("year.perYear", { defaultValue:"anno" })}
                              </div>
                              {item.missingCount > 0 && (
                                <div style={{ fontSize:10, color:"#d08b6a", marginTop:2 }}>
                                  {t("year.missing", { count: item.missingCount, defaultValue: "stima mancante" })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}

                      {recurringAuto.length > 0 && recurringManual.length > 0 && (
                        <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase", letterSpacing:".4px", margin:"6px 0" }}>
                          {t("year.recurringAuto", { defaultValue:"Automatiche" })}
                        </div>
                      )}
                      {recurringAuto.map(item => (
                        <div key={item.id} style={{
                          background:"#fff", borderRadius:16, border:"1px solid #edecea",
                          padding:"12px 14px", marginBottom:10, boxShadow:"0 2px 8px rgba(0,0,0,.03)"
                        }}>
                          <div style={{ display:"flex", justifyContent:"space-between", gap:12 }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:14, fontWeight:800, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                {item.title}
                              </div>
                              <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>
                                {item.frequency} · {t("year.occurrences", { count: item.count, defaultValue: `${item.count} occ.` })}
                              </div>
                              {item.nextDate && (
                                <div style={{ fontSize:11, color:"#b2afa7", marginTop:2 }}>
                                  {t("year.next", { defaultValue:"Prossima" })}: {fmtDate(item.nextDate)}
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign:"right" }}>
                              <div style={{ fontSize:15, fontWeight:800, color:"#2d2b26" }}>
                                {formatCurrency(item.knownTotal)}
                              </div>
                              <div style={{ fontSize:10, color:"#b2afa7", textTransform:"uppercase", letterSpacing:".4px" }}>
                                {t("year.perYear", { defaultValue:"anno" })}
                              </div>
                              {item.missingCount > 0 && (
                                <div style={{ fontSize:10, color:"#d08b6a", marginTop:2 }}>
                                  {t("year.missing", { count: item.missingCount, defaultValue: "stima mancante" })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )
            ) : groups.length === 0 ? (
              <div style={{ textAlign:"center", padding:"60px 20px", color:"#b5b2a8" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>{activeTab === "done" ? "🎉" : "📅"}</div>
                <div style={{ fontSize:15, fontWeight:600, color:"#8a877f" }}>
                  {activeTab === "done" ? t("empty.doneTitle") : t("empty.timelineTitle")}
                </div>
                <div style={{ fontSize:13, marginTop:4 }}>
                  {activeTab === "timeline"
                    ? t("empty.hint") + " · " + periodLabel
                    : t("empty.hint")}
                </div>
                {activeTab === "timeline" && (
                  <div style={{ fontSize:12, marginTop:6, color:"#b5b2a8" }}>
                    {t("empty.periodHint", { defaultValue: "Use the arrows to move between periods." })}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ position:"relative", paddingLeft:26, marginTop:4 }}>
                <div style={{ position:"absolute", left:10, top:0, bottom:0, width:2, background:"#e2e0da" }}/>
                {groups.map(g => (
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
                        onEdit={handleEditItem}
                        onUploadDoc={handleDocumentUpload}
                        onDeleteDoc={deleteDocument}
                        onViewDoc={setViewingDoc}
                        onAssetClick={(cat, asset) => setShowAsset({ cat, asset })}
                        cats={cats}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div style={{ textAlign:"center", color:"#b5b2a8", fontSize:10, padding:"14px 0 6px", lineHeight:1.4 }}>
              v{APP_VERSION}{APP_BUILD_TIME ? ` · ${new Date(APP_BUILD_TIME).toLocaleDateString(getLocale())}` : ""}
              {user?.email ? ` · ${user.email}` : ""}
              {user?.uid ? ` · uid:${user.uid.slice(0, 6)}` : ""}
              {remoteInfo.lastSync ? ` · sync:${new Date(remoteInfo.lastSync).toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit' })}` : ""}
            </div>
          </div>

          <button onClick={() => setShowFilters(true)} style={{
            position:"fixed", bottom:88, right: "calc(50% - 195px + 72px)", width:48, height:48, borderRadius:"50%",
            background:"#2d2b26", border:"none", color:"#fff", fontSize:20, fontWeight:700,
            cursor:"pointer", boxShadow:"0 6px 20px rgba(0,0,0,.2)",
            display:"flex", alignItems:"center", justifyContent:"center", zIndex:60,
          }}>≡</button>

          {/* FAB */}
          <button onClick={() => setShowAdd(true)} style={{
            position:"fixed", bottom:88, right: "calc(50% - 195px)", width:58, height:58, borderRadius:"50%",
            background:"#E8855D", border:"none", color:"#fff", fontSize:28, fontWeight:300,
            cursor:"pointer", boxShadow:"0 6px 24px rgba(232,133,93,.45)",
            display:"flex", alignItems:"center", justifyContent:"center", zIndex:60,
          }}>+</button>
        </div>
      )}

      {mainSection === "assets" && (
        <div style={{ flex:1, overflowY:"auto", padding:"16px 18px 90px", background:"#f5f4f0" }}>
          <div style={{ marginBottom:12 }}>
            <input
              type="text"
              placeholder={t("assetList.search", { defaultValue:"Cerca asset..." })}
              style={{ width:"100%", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", fontSize:13, background:"#fff" }}
            />
          </div>
          {(() => {
            const assetsByCategory = cats
              .map(cat => {
                if (!cat.assets || cat.assets.length === 0) return null;
                return {
                  cat,
                  assets: cat.assets.map(assetName => {
                    const assetDeadlines = activeDeadlines.filter(d => d.cat === cat.id && d.asset === assetName);
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
            if (!hasAssets) {
              return (
                <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
                  <div style={{ fontSize:48, marginBottom:16 }}>🏷️</div>
                  <div style={{ fontSize:16, fontWeight:600, color:"#8a877f", marginBottom:8 }}>{t("assetList.emptyTitle")}</div>
                  <div style={{ fontSize:13, color:"#b5b2a8", lineHeight:1.6 }}>
                    {t("assetList.emptyHint")}
                  </div>
                </div>
              );
            }
            return assetsByCategory.map(({ cat, assets }) => (
              <div key={cat.id} style={{ marginBottom:24 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:16 }}>{cat.icon}</span>
                  {t(cat.labelKey || "", { defaultValue: cat.label })}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {assets.map(asset => (
                    <button
                      key={asset.name}
                      onClick={() => setShowAsset({ cat: cat.id, asset: asset.name })}
                      style={{
                        display:"flex", alignItems:"center", gap:12, background:"#fff", 
                        borderRadius:12, padding:"12px 14px", cursor:"pointer", border:"1px solid #e8e6e0",
                        transition:"all .2s", textAlign:"left",
                      }}
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
            ));
          })()}
        </div>
      )}

      {mainSection === "documents" && (
        <div style={{ flex:1, overflowY:"auto", padding:"16px 18px 90px", background:"#f5f4f0" }}>
          <div style={{ marginBottom:10, display:"flex", gap:8 }}>
            <button style={{ padding:"8px 12px", borderRadius:14, border:"none", background:"#2d2b26", color:"#fff", fontSize:12, fontWeight:700 }}>
              {t("docs.filterAll", { defaultValue:"Tutti" })}
            </button>
            <button style={{ padding:"8px 12px", borderRadius:14, border:"none", background:"#edecea", color:"#6b6961", fontSize:12, fontWeight:700 }}>
              {t("docs.filterDocs", { defaultValue:"Documenti" })}
            </button>
            <button style={{ padding:"8px 12px", borderRadius:14, border:"none", background:"#edecea", color:"#6b6961", fontSize:12, fontWeight:700 }}>
              {t("docs.filterReceipts", { defaultValue:"Ricevute" })}
            </button>
          </div>
          {(() => {
            const deadlineDocs = activeDeadlines.flatMap(d => (d.documents || []).map(doc => ({ ...doc, source:"deadline", deadline: d })));
            const assetDocsList = Object.entries(assetDocs || {}).flatMap(([assetKey, docs]) =>
              (docs || []).map(doc => ({ ...doc, source:"asset", assetKey }))
            );
            const workLogDocs = Object.entries(workLogs || {}).flatMap(([assetKey, logs]) =>
              (logs || []).flatMap(log => (log.attachments || []).map(doc => ({ ...doc, source:"worklog", assetKey, workLog: log })))
            );
            const getDocTime = (d) => d?.uploadDate ? new Date(d.uploadDate).getTime() : 0;
            const docs = [...deadlineDocs, ...assetDocsList, ...workLogDocs].sort((a, b) => getDocTime(b) - getDocTime(a));
            if (docs.length === 0) {
              return (
                <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
                  <div style={{ fontSize:48, marginBottom:16 }}>📎</div>
                  <div style={{ fontSize:16, fontWeight:600, color:"#8a877f", marginBottom:8 }}>{t("docs.none")}</div>
                </div>
              );
            }
            return docs.map(doc => (
              <div key={doc.id} style={{ background:"#fff", borderRadius:12, padding:"12px 14px", border:"1px solid #e8e6e0", marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>{doc.filename || t("docs.defaultTitle")}</div>
                <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>
                  {doc.source === "deadline" && doc.deadline ? `${doc.deadline.title} · ${doc.deadline.date?.toLocaleDateString?.(getLocale())}` : ""}
                  {doc.source === "asset" && doc.assetKey ? `Asset · ${doc.assetKey.replace(/_/g, " ")}` : ""}
                  {doc.source === "worklog" && doc.workLog ? `${doc.workLog.title} · ${doc.workLog.date?.toLocaleDateString?.(getLocale())}` : ""}
                </div>
                <button onClick={() => setViewingDoc(doc)} style={{ marginTop:8, padding:"6px 10px", borderRadius:8, border:"none", background:"#EBF2FC", color:"#5B8DD9", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  {t("actions.view")}
                </button>
              </div>
            ));
          })()}
        </div>
      )}

      {mainSection === "pet" && (
        <div style={{ flex:1, overflowY:"auto", padding:"16px 18px 90px", background:"#f5f4f0" }}>
          {!activePetId ? (
            <>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#2d2b26" }}>{t("pet.title")}</div>
                <button onClick={() => setShowPetAdd(true)} style={{ padding:"8px 12px", borderRadius:999, border:"none", background:"#E8855D", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ {t("pet.add")}</button>
              </div>
              <input
                type="text"
                placeholder={t("pet.search")}
                value={petSearch}
                onChange={e => setPetSearch(e.target.value)}
                style={{ width:"100%", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", fontSize:13, background:"#fff", marginBottom:14 }}
              />

              {(() => {
                const filtered = pets.filter(p => p.name.toLowerCase().includes(petSearch.toLowerCase()));
                if (!filtered.length) {
                  return (
                    <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
                      <div style={{ fontSize:48, marginBottom:16 }}>🐾</div>
                      <div style={{ fontSize:16, fontWeight:600, color:"#8a877f", marginBottom:8 }}>{t("pet.emptyTitle")}</div>
                      <div style={{ fontSize:13, color:"#b5b2a8", lineHeight:1.6 }}>{t("pet.emptyHint")}</div>
                    </div>
                  );
                }
                const year = new Date().getFullYear();
                return filtered.map(p => {
                  const pEvents = petEvents.filter(e => e.petId === p.id);
                  const pDeadlines = petDeadlines.filter(d => d.petId === p.id);
                  const next = pDeadlines
                    .filter(d => d.date && new Date(d.date) >= new Date())
                    .sort((a,b) => new Date(a.date) - new Date(b.date))[0];
                  const yearSpend = pEvents
                    .filter(e => e.date && new Date(e.date).getFullYear() === year)
                    .reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
                  return (
                    <button key={p.id} onClick={() => { setActivePetId(p.id); setPetTab("overview"); }} style={{
                      width:"100%", textAlign:"left", background:"#fff", border:"1px solid #e8e6e0",
                      borderRadius:14, padding:"12px 14px", marginBottom:10, cursor:"pointer"
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <div style={{ width:46, height:46, borderRadius:12, background:"#FFE9E0", border:"2px solid #E8855D33", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, overflow:"hidden" }}>
                          {p.photo ? (
                            <img src={p.photo} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                          ) : (
                            "🐾"
                          )}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:15, fontWeight:800, color:"#2d2b26" }}>{p.name}</div>
                          <div style={{ fontSize:12, color:"#8a877f" }}>{t(`pet.${p.species}`)}{p.birth ? ` · ${new Date(p.birth).getFullYear()}` : ""}</div>
                          <div style={{ fontSize:12, color:"#8a877f", marginTop:4 }}>
                            {next ? `${t("pet.nextDeadline")}: ${next.title} · ${new Date(next.date).toLocaleDateString(getLocale())}` : t("pet.noDeadlines")}
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:14, fontWeight:800, color:"#2d2b26" }}>€{formatNumber(yearSpend)}</div>
                          <div style={{ fontSize:10, color:"#8a877f" }}>{t("pet.yearSpend", { year })}</div>
                        </div>
                      </div>
                    </button>
                  );
                });
              })()}
            </>
          ) : (
            (() => {
              const pet = pets.find(p => p.id === activePetId);
              if (!pet) return null;
              const pEvents = petEvents.filter(e => e.petId === pet.id).sort((a,b) => new Date(b.date) - new Date(a.date));
              const pDeadlines = petDeadlines.filter(d => d.petId === pet.id).sort((a,b) => new Date(a.date) - new Date(b.date));
              const pDocs = petDocs.filter(d => d.petId === pet.id).sort((a,b) => new Date(b.uploadDate || 0) - new Date(a.uploadDate || 0));
              const nextDeadline = pDeadlines.find(d => d.date && new Date(d.date) >= new Date());
              const lastEvent = pEvents[0];
              const year = new Date().getFullYear();
              const yearSpend = pEvents.filter(e => e.date && new Date(e.date).getFullYear() === year).reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
              return (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                    <button onClick={() => setActivePetId(null)} style={{ border:"none", background:"#fff", borderRadius:10, padding:"6px 10px", cursor:"pointer" }}>←</button>
                    <div style={{ width:36, height:36, borderRadius:10, background:"#FFE9E0", border:"1px solid #E8855D33", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, overflow:"hidden" }}>
                      {pet.photo ? (
                        <img src={pet.photo} alt={pet.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                      ) : (
                        "🐾"
                      )}
                    </div>
                    <div style={{ fontSize:18, fontWeight:800, color:"#2d2b26" }}>{pet.name}</div>
                    <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
                      <button onClick={() => startEditPet(pet)} style={{ border:"none", background:"#f0efec", borderRadius:10, padding:"6px 10px", cursor:"pointer", fontSize:12, fontWeight:700, color:"#2d2b26" }}>
                        {t("actions.edit")}
                      </button>
                      <button onClick={() => deletePet(pet.id)} style={{ border:"none", background:"#FFEDEE", borderRadius:10, padding:"6px 10px", cursor:"pointer", fontSize:12, fontWeight:700, color:"#E53935" }}>
                        {t("actions.delete")}
                      </button>
                    </div>
                  </div>

                  <div style={{ display:"flex", gap:8, background:"#fff", padding:"8px", borderRadius:14, border:"1px solid #e8e6e0", marginBottom:12 }}>
                    {["overview","health","deadlines","docs"].map(tab => (
                      <button key={tab} onClick={() => setPetTab(tab)} style={{
                        flex:1, padding:"8px 10px", borderRadius:12, border:"none",
                        background: petTab === tab ? "#2d2b26" : "#f0efec",
                        color: petTab === tab ? "#fff" : "#6b6961", fontSize:12, fontWeight:700, cursor:"pointer"
                      }}>{t(`pet.${tab === "docs" ? "docs" : tab}`)}</button>
                    ))}
                  </div>

                  {petTab === "overview" && (
                    <>
                      <div style={{ background:"#2d2b26", color:"#fff", borderRadius:16, padding:"14px 16px", marginBottom:10 }}>
                        <div style={{ fontSize:12, color:"#C9C5BC" }}>{t("pet.nextDeadline")}</div>
                        <div style={{ fontSize:16, fontWeight:800, marginTop:4 }}>
                          {nextDeadline ? `${nextDeadline.title} · ${new Date(nextDeadline.date).toLocaleDateString(getLocale())}` : "—"}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:10, marginBottom:10 }}>
                        <div style={{ flex:1, background:"#fff", border:"1px solid #e8e6e0", borderRadius:14, padding:"12px" }}>
                          <div style={{ fontSize:11, color:"#8a877f" }}>{t("pet.yearSpend", { year })}</div>
                          <div style={{ fontSize:18, fontWeight:800, color:"#2d2b26" }}>€{formatNumber(yearSpend)}</div>
                        </div>
                        <div style={{ flex:1, background:"#fff", border:"1px solid #e8e6e0", borderRadius:14, padding:"12px" }}>
                          <div style={{ fontSize:11, color:"#8a877f" }}>{t("pet.lastEvent")}</div>
                          <div style={{ fontSize:14, fontWeight:800, color:"#2d2b26" }}>
                            {lastEvent ? `${lastEvent.title}` : "—"}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => setShowPetEventModal(true)} style={{ width:"100%", padding:"12px", borderRadius:14, border:"none", background:"#E8855D", color:"#fff", fontWeight:800, marginBottom:10 }}>{t("pet.addEvent")}</button>
                    </>
                  )}

                  {petTab === "health" && (
                    <>
                      <button onClick={() => setShowPetEventModal(true)} style={{ width:"100%", padding:"12px", borderRadius:14, border:"none", background:"#E8855D", color:"#fff", fontWeight:800, marginBottom:10 }}>{t("pet.addEvent")}</button>
                      {pEvents.length === 0 ? (
                        <div style={{ textAlign:"center", padding:"20px", color:"#b5b2a8" }}>{t("pet.noEvents")}</div>
                      ) : pEvents.map(ev => (
                        <div key={ev.id} style={{ background:"#fff", border:"1px solid #e8e6e0", borderRadius:14, padding:"12px 14px", marginBottom:8 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <div style={{ fontSize:14, fontWeight:800, color:"#2d2b26" }}>{ev.title}</div>
                            <div style={{ fontSize:14, fontWeight:800, color:"#4CAF6E" }}>€{formatNumber(Number(ev.cost) || 0)}</div>
                          </div>
                          <div style={{ fontSize:12, color:"#8a877f" }}>{ev.date ? new Date(ev.date).toLocaleDateString(getLocale()) : ""}</div>
                          {!!(ev.attachments?.length) && <div style={{ fontSize:11, color:"#8a877f", marginTop:6 }}>📎 {ev.attachments.length}</div>}
                        </div>
                      ))}
                    </>
                  )}

                  {petTab === "deadlines" && (
                    <>
                      <button onClick={() => setShowPetDeadlineModal(true)} style={{ width:"100%", padding:"12px", borderRadius:14, border:"none", background:"#E8855D", color:"#fff", fontWeight:800, marginBottom:10 }}>{t("pet.addDeadline")}</button>
                      {pDeadlines.length === 0 ? (
                        <div style={{ textAlign:"center", padding:"20px", color:"#b5b2a8" }}>{t("pet.noDeadlines")}</div>
                      ) : pDeadlines.map(d => (
                        <div key={d.id} style={{ background:"#fff", border:"1px solid #e8e6e0", borderRadius:14, padding:"12px 14px", marginBottom:8 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <div style={{ fontSize:14, fontWeight:800, color:"#2d2b26" }}>{d.title}</div>
                            <div style={{ fontSize:14, fontWeight:800, color:"#4CAF6E" }}>€{formatNumber(Number(d.cost) || 0)}</div>
                          </div>
                          <div style={{ fontSize:12, color:"#8a877f" }}>{d.date ? new Date(d.date).toLocaleDateString(getLocale()) : ""}</div>
                        </div>
                      ))}
                    </>
                  )}

                  {petTab === "docs" && (
                    <>
                      <button onClick={() => setShowPetDocModal(true)} style={{ width:"100%", padding:"12px", borderRadius:14, border:"none", background:"#E8855D", color:"#fff", fontWeight:800, marginBottom:10 }}>{t("pet.addDoc")}</button>
                      {pDocs.length === 0 ? (
                        <div style={{ textAlign:"center", padding:"20px", color:"#b5b2a8" }}>{t("pet.noDocs")}</div>
                      ) : pDocs.map(doc => (
                        <div key={doc.id} onClick={() => setViewingDoc(doc)} style={{ background:"#fff", border:"1px solid #e8e6e0", borderRadius:14, padding:"12px 14px", marginBottom:8, cursor:"pointer" }}>
                          <div style={{ fontSize:13, fontWeight:800, color:"#2d2b26" }}>{doc.filename || t("docs.defaultTitle")}</div>
                          <div style={{ fontSize:11, color:"#8a877f" }}>{doc.uploadDate ? new Date(doc.uploadDate).toLocaleDateString(getLocale()) : ""}</div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              );
            })()
          )}
        </div>
      )}

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
        onToast={showToast}
      />
      <StatsSheet open={showStats} onClose={() => setShowStats(false)} deadlines={activeDeadlines} cats={cats}/>
      {/* AssetListSheet no longer used in main nav */}
      {showAsset && (
        <AssetSheet 
          open={true} 
          onClose={() => setShowAsset(null)} 
          deadlines={activeDeadlines} 
          cats={cats}
          assetDocs={assetDocs}
          catId={showAsset.cat}
          assetName={showAsset.asset}
          workLogs={workLogs}
          onUploadAttachments={uploadAttachments}
          onAddWorkLog={(assetKey, work, editId) => {
            if (!work && editId) {
              setWorkLogs(prev => ({
                ...prev,
                [assetKey]: (prev[assetKey] || []).filter(w => w.id !== editId)
              }));
              showToast(t("toast.worklogDeleted"));
            } else if (editId) {
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
          onCreateDeadline={(payload) => {
            if (!payload?.date) return;
            const dateObj = new Date(payload.date + "T00:00:00");
            if (Number.isNaN(dateObj.getTime())) return;

            const alreadyExists = activeDeadlines.some(d =>
              d.asset === showAsset.asset &&
              d.cat === showAsset.cat &&
              d.title === payload.title &&
              d.date instanceof Date &&
              d.date.toISOString().split('T')[0] === payload.date
            );
            if (alreadyExists) return;

            const budget = Number(payload.cost) || 0;
            const newDeadline = {
              id: Date.now(),
              title: payload.title,
              cat: showAsset.cat,
              asset: showAsset.asset,
              date: dateObj,
              budget,
              estimateMissing: budget === 0,
              notes: payload.description || "",
              recurring: null,
              mandatory: false,
              autoPay: false,
              essential: false,
              documents: payload.documents || [],
              done: !!payload.completed
            };
            add(newDeadline);
          }}
          onViewDoc={setViewingDoc}
        />
      )}
      <CategorySheet 
        open={showCats} 
        onClose={() => setShowCats(false)} 
        cats={cats} 
        onUpdateCats={setCats}
        onAddAsset={handleAddAsset}
        deadlines={activeDeadlines}
        workLogs={workLogs}
        onResetAll={resetCloudData}
      />

      {/* Primary navigation - bottom */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid #edecea", display:"flex", zIndex:120 }}>
        {[
          { id:"deadlines", label: t("nav.deadlines"), icon:"📅" },
          { id:"assets", label: t("nav.assets"), icon:"🏷️" },
          { id:"documents", label: t("nav.documents"), icon:"📎" },
          { id:"pet", label: t("nav.pet"), icon:"🐾" }
        ].map(item => (
          <button key={item.id} onClick={() => setMainSection(item.id)} style={{
            flex:1, padding:"10px 0", border:"none", background:"transparent", cursor:"pointer",
            color: mainSection === item.id ? "#2d2b26" : "#8a877f", fontSize:12, fontWeight:700
          }}>
            <div style={{ fontSize:18 }}>{item.icon}</div>
            {item.label}
          </button>
        ))}
      </div>

      {/* Hamburger menu */}
      {showMenu && (
        <div onClick={e => e.target === e.currentTarget && setShowMenu(false)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,.35)", zIndex:200, display:"flex", justifyContent:"flex-end"
        }}>
          <div style={{ width:260, background:"#fff", height:"100%", padding:"20px 16px" }}>
            <div style={{ fontSize:14, fontWeight:800, marginBottom:14 }}>{t("menu.title")}</div>
            <div style={{ marginBottom:10 }}>
              <LanguageToggle size={28} />
            </div>
            <div style={{ marginBottom:10, padding:"10px", borderRadius:10, border:"1px solid #e8e6e0", background:"#faf9f7", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#2d2b26" }}>
                {t("menu.sync")}
              </div>
              <button
                onClick={() => setSyncEnabled(v => !v)}
                style={{
                  padding:"6px 10px",
                  borderRadius:999,
                  border:"none",
                  background: syncEnabled ? "#4CAF6E" : "#E53935",
                  color:"#fff",
                  fontSize:11,
                  fontWeight:700,
                  cursor:"pointer",
                  minWidth:64
                }}
              >
                {syncEnabled ? t("menu.syncOn") : t("menu.syncOff")}
              </button>
            </div>
            <button onClick={() => { setShowStats(true); setShowMenu(false); }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"1px solid #e8e6e0", background:"#faf9f7", textAlign:"left", marginBottom:8 }}>📈 {t("menu.stats")}</button>
            {isDevUser && (
              <button onClick={() => { setShowDev(true); setShowMenu(false); }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"1px solid #e8e6e0", background:"#faf9f7", textAlign:"left", marginBottom:8 }}>🛠 {t("menu.developer")}</button>
            )}
            <button onClick={() => { setShowCats(true); setShowMenu(false); }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"1px solid #e8e6e0", background:"#faf9f7", textAlign:"left", marginBottom:8 }}>⚙ {t("menu.settings")}</button>
            <button onClick={() => { handleSignOut(); setShowMenu(false); }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"1px solid #ffe1da", background:"#fff5f1", textAlign:"left", color:"#E53935" }}>⎋ {t("menu.logout")}</button>
          </div>
        </div>
      )}

      {/* Developer panel */}
      {showDev && isDevUser && (
        <div onClick={e => e.target === e.currentTarget && setShowDev(false)} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:210,
          display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)"
        }}>
          <div style={{
            width:"90%", maxWidth:420, background:"#fff", borderRadius:18, padding:"18px 18px 16px",
            boxShadow:"0 18px 60px rgba(0,0,0,.25)", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch"
          }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ fontSize:16, fontWeight:800, color:"#2d2b26" }}>{t("dev.title")}</div>
              <button onClick={() => setShowDev(false)} style={{ border:"none", background:"transparent", fontSize:20, cursor:"pointer", color:"#8a877f" }}>✕</button>
            </div>

            <div style={{ display:"grid", gap:8, fontSize:12, color:"#5f5c54" }}>
              <div style={{ fontWeight:700, color:"#2d2b26" }}>{t("dev.sectionApp")}</div>
              <div>• {t("dev.version")}: v{APP_VERSION}</div>
              <div>• {t("dev.build")}: {APP_BUILD_TIME ? new Date(APP_BUILD_TIME).toLocaleString(getLocale()) : "—"}</div>
              <div>• {t("dev.user")}: {user?.email || "—"}</div>
              <div>• {t("dev.uid")}: {user?.uid ? user.uid.slice(0, 10) : "—"}</div>

              <div style={{ fontWeight:700, color:"#2d2b26", marginTop:6 }}>{t("dev.sectionData")}</div>
              <div>• {t("dev.deadlines")}: {devStats.totalDeadlines}</div>
              <div>• {t("dev.workLogs")}: {devStats.totalWorkLogs}</div>
              <div>• {t("dev.assetDocs")}: {devStats.totalAssetDocs}</div>
              <div>• {t("dev.pets")}: {devStats.totalPets}</div>
              <div>• {t("dev.petEvents")}: {devStats.totalPetEvents}</div>
              <div>• {t("dev.petDeadlines")}: {devStats.totalPetDeadlines}</div>
              <div>• {t("dev.petDocs")}: {devStats.totalPetDocs}</div>
              <div>• {t("dev.deadlineDocs")}: {devStats.deadlineDocs}</div>
              <div>• {t("dev.workLogDocs")}: {devStats.workLogAttachments}</div>
              <div>• {t("dev.totalDocs")}: {devStats.totalAttachments}</div>

              <div style={{ fontWeight:700, color:"#2d2b26", marginTop:6 }}>{t("dev.sectionSync")}</div>
              <div>• {t("dev.syncEnabled")}: {syncEnabled ? t("dev.yes") : t("dev.no")}</div>
              <div>• {t("dev.lastSync")}: {devStats.lastSync ? new Date(Number(devStats.lastSync)).toLocaleString(getLocale()) : "—"}</div>
              <div>• {t("dev.lastFullSync")}: {devStats.lastFullSync ? new Date(Number(devStats.lastFullSync)).toLocaleString(getLocale()) : "—"}</div>
              <div>• {t("dev.backoff")}: {Math.round((pollStateRef.current?.backoffMs || 0) / 1000)}s</div>
              <div>• {t("dev.cloudStatus")}: {remoteInfo.error ? `ERR:${remoteInfo.error}` : (remoteInfo.count !== null ? `OK (${remoteInfo.count})` : "—")}</div>
              <button onClick={triggerRepairSync} style={{
                marginTop:6, width:"100%", padding:"10px", borderRadius:12, border:"1px solid #f0c9b8",
                background:"#fff6f2", color:"#d87a54", fontSize:12, fontWeight:700, cursor:"pointer"
              }}>
                {t("dev.repairSync")}
              </button>
              <div style={{ fontSize:11, color:"#a59f92", lineHeight:1.4 }}>
                {t("dev.repairHint")}
              </div>
            </div>

            <div style={{ marginTop:16, paddingTop:14, borderTop:"2px solid #f5f4f0" }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>{t("backup.title")}</div>

              <button onClick={() => {
                const data = {
                  version: "1.1",
                  exportDate: new Date().toISOString(),
                  categories: cats,
                  deadlines: activeDeadlines,
                  workLogs: workLogs,
                  assetDocs: assetDocs,
                  pets: pets,
                  petEvents: petEvents,
                  petDeadlines: petDeadlines,
                  petDocs: petDocs
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

                      if (!data.categories || !data.deadlines) {
                        alert(t("backup.invalidFile"));
                        return;
                      }

                      if (!window.confirm(t("backup.importConfirm", { deadlines: data.deadlines.length, categories: data.categories.length }))) {
                        return;
                      }

                      localStorage.setItem('lifetrack_categories', JSON.stringify(data.categories));
                      localStorage.setItem('lifetrack_deadlines', JSON.stringify(data.deadlines));
                      localStorage.setItem('lifetrack_worklogs', JSON.stringify(data.workLogs || {}));
                      localStorage.setItem('lifetrack_asset_docs', JSON.stringify(data.assetDocs || {}));
                      localStorage.setItem('lifetrack_pets', JSON.stringify(data.pets || []));
                      localStorage.setItem('lifetrack_pet_events', JSON.stringify(data.petEvents || []));
                      localStorage.setItem('lifetrack_pet_deadlines', JSON.stringify(data.petDeadlines || []));
                      localStorage.setItem('lifetrack_pet_docs', JSON.stringify(data.petDocs || []));

                      alert(t("backup.imported"));
                      window.location.reload();
                    } catch (err) {
                      alert(t("backup.readError", { message: err.message }));
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = '';
                }} />
                {t("backup.import")}
              </label>

              <div style={{ fontSize:10, color:"#8a877f", marginTop:8, lineHeight:1.4 }}>
                💡 <strong>{t("backup.shareTipTitle")}</strong> {t("backup.shareTip")}
              </div>

              <button onClick={() => {
                if (window.confirm(t("backup.resetConfirm"))) {
                  localStorage.removeItem('lifetrack_categories');
                  localStorage.removeItem('lifetrack_deadlines');
                  localStorage.removeItem('lifetrack_deadlines_version');
                  localStorage.removeItem('lifetrack_worklogs');
                  localStorage.removeItem('lifetrack_asset_docs');
                  window.location.reload();
                }
              }} style={{ 
                width:"100%", padding:"12px", borderRadius:14, border:"1px solid #FBE9E7", background:"#FFF0EC", color:"#E53935", cursor:"pointer", fontSize:12, fontWeight:600, marginTop:12 
              }}>{t("backup.reset")}</button>
              {resetCloudData && (
                <button onClick={resetCloudData} style={{ 
                  width:"100%", padding:"12px", borderRadius:14, border:"1px solid #E53935", background:"#E53935", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, marginTop:8 
                }}>{t("backup.resetCloud")}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Pet modal */}
      {showPetAdd && (
        <div onClick={e => e.target === e.currentTarget && closePetModal()} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:210,
          display:"flex", alignItems:"flex-start", justifyContent:"center", backdropFilter:"blur(4px)",
          padding:"6vh 0 20px"
        }}>
          <div style={{ width:"90%", maxWidth:380, background:"#fff", borderRadius:18, padding:"18px", maxHeight:"85vh", overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch" }}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:12 }}>{editingPetId ? t("pet.edit") : t("pet.add")}</div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
              <div style={{
                width:56, height:56, borderRadius:16, background:"#f7f6f2", border:"1px solid #e8e6e0",
                display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden"
              }}>
                {petForm.photo ? (
                  <img src={petForm.photo} alt="pet" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                ) : (
                  <span style={{ fontSize:22 }}>🐾</span>
                )}
              </div>
              <label style={{ flex:1, padding:"8px 10px", borderRadius:10, border:"1px dashed #e8e6e0", textAlign:"center", cursor:"pointer", fontSize:11, fontWeight:700, color:"#6b6961" }}>
                {t("pet.photoUpload")}
                <input type="file" accept="image/*" style={{ display:"none" }} onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => setPetForm(prev => ({ ...prev, photo: reader.result }));
                    reader.readAsDataURL(file);
                  }
                  e.target.value = "";
                }} />
              </label>
            </div>
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.name")}</label>
            <input value={petForm.name} onChange={e => setPetForm({ ...petForm, name: e.target.value })} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:10, fontSize:16 }} />
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.species")}</label>
            <select value={petForm.species} onChange={e => setPetForm({ ...petForm, species: e.target.value })} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:10, fontSize:16, WebkitAppearance:"none" }}>
              <option value="dog">{t("pet.dog")}</option>
              <option value="cat">{t("pet.cat")}</option>
              <option value="other">{t("pet.other")}</option>
            </select>
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.birth")}</label>
            <input type="date" value={petForm.birth} onChange={e => setPetForm({ ...petForm, birth: e.target.value })} style={{ ...dateInpModal, marginBottom:10 }} />
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.notes")}</label>
            <textarea value={petForm.notes} onChange={e => setPetForm({ ...petForm, notes: e.target.value })} rows={3} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:12, fontSize:16 }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={closePetModal} style={{ flex:1, padding:"10px", borderRadius:12, border:"1px solid #e8e6e0", background:"#fff" }}>{t("actions.cancel")}</button>
              <button onClick={addPet} style={{ flex:1, padding:"10px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", fontWeight:700 }}>{t("actions.confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Pet Event modal */}
      {showPetEventModal && (
        <div onClick={e => e.target === e.currentTarget && setShowPetEventModal(false)} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:210,
          display:"flex", alignItems:"flex-start", justifyContent:"center", backdropFilter:"blur(4px)",
          padding:"6vh 0 20px"
        }}>
          <div style={{ width:"92%", maxWidth:420, background:"#fff", borderRadius:18, padding:"18px", maxHeight:"85vh", overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch" }}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:12 }}>{t("pet.addEvent")}</div>
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.eventTitle")}</label>
            <input value={petEventForm.title} onChange={e => setPetEventForm({ ...petEventForm, title: e.target.value })} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:10, fontSize:16, WebkitAppearance:"none" }} />
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.eventDate")}</label>
            <input type="date" value={petEventForm.date} onChange={e => setPetEventForm({ ...petEventForm, date: e.target.value })} style={{ ...dateInpModal, marginBottom:10 }} />
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.eventCost")}</label>
            <input type="number" value={petEventForm.cost} onChange={e => setPetEventForm({ ...petEventForm, cost: e.target.value })} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:10, fontSize:16 }} />
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.eventNotes")}</label>
            <textarea value={petEventForm.notes} onChange={e => setPetEventForm({ ...petEventForm, notes: e.target.value })} rows={3} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:10, fontSize:16 }} />

            <label style={{ display:"flex", gap:8, alignItems:"center", fontSize:12, fontWeight:700, color:"#2d2b26", marginBottom:8 }}>
              <input type="checkbox" checked={petEventForm.schedule} onChange={e => setPetEventForm({ ...petEventForm, schedule: e.target.checked })} />
              {t("pet.scheduleNext")}
            </label>
            {petEventForm.schedule && (
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
                <select value={petEventForm.schedulePreset} onChange={e => setPetEventForm({ ...petEventForm, schedulePreset: e.target.value })} style={{ flex:1, padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", boxSizing:"border-box" }}>
                  <option value="1m">{t("pet.schedule1m")}</option>
                  <option value="6m">{t("pet.schedule6m")}</option>
                  <option value="12m">{t("pet.schedule12m")}</option>
                  <option value="exact">{t("pet.scheduleExact")}</option>
                </select>
                {petEventForm.schedulePreset === "exact" && (
                  <input type="date" value={petEventForm.scheduleDate} onChange={e => setPetEventForm({ ...petEventForm, scheduleDate: e.target.value })} style={{ ...dateInpModal, flex:1 }} />
                )}
              </div>
            )}

            <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6 }}>{t("pet.attachments")}</div>
            {petEventFiles.map((f, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#f7f6f2", padding:"6px 8px", borderRadius:8, marginBottom:6 }}>
                <div style={{ fontSize:12 }}>{f.name}</div>
                <button onClick={() => setPetEventFiles(petEventFiles.filter((_, idx) => idx !== i))} style={{ border:"none", background:"transparent", color:"#E53935", cursor:"pointer" }}>{t("actions.remove")}</button>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <label style={{ flex:1, padding:"10px", borderRadius:12, border:"2px dashed #e8e6e0", textAlign:"center", cursor:"pointer", fontWeight:700, fontSize:12, color:"#6b6961" }}>
                {t("attachments.upload")}
                <input type="file" accept="image/*,application/pdf,*/*" style={{ display:"none" }} onChange={e => setPetEventFiles(mergeFiles(petEventFiles, e.target.files))} />
              </label>
            </div>

            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowPetEventModal(false)} style={{ flex:1, padding:"10px", borderRadius:12, border:"1px solid #e8e6e0", background:"#fff" }}>{t("actions.cancel")}</button>
              <button onClick={addPetEvent} style={{ flex:1, padding:"10px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", fontWeight:700 }}>{t("actions.confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Pet Deadline modal */}
      {showPetDeadlineModal && (
        <div onClick={e => e.target === e.currentTarget && closePetDeadlineModal()} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:210,
          display:"flex", alignItems:"flex-start", justifyContent:"center", backdropFilter:"blur(4px)",
          padding:"6vh 0 20px"
        }}>
          <div style={{ width:"90%", maxWidth:380, background:"#fff", borderRadius:18, padding:"18px", maxHeight:"85vh", overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch" }}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:12 }}>{t("pet.addDeadline")}</div>
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.deadlineTitle")}</label>
            <input value={petDeadlineForm.title} onChange={e => setPetDeadlineForm({ ...petDeadlineForm, title: e.target.value })} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:10, fontSize:16 }} />
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.deadlineDate")}</label>
            <input type="date" value={petDeadlineForm.date} onChange={e => setPetDeadlineForm({ ...petDeadlineForm, date: e.target.value })} style={{ ...dateInpModal, marginBottom:10 }} />
            <label style={{ fontSize:11, fontWeight:700, color:"#8a877f" }}>{t("pet.deadlineCost")}</label>
            <input type="number" value={petDeadlineForm.cost} onChange={e => setPetDeadlineForm({ ...petDeadlineForm, cost: e.target.value })} style={{ width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:12, border:"1px solid #e8e6e0", marginBottom:12, fontSize:16 }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={closePetDeadlineModal} style={{ flex:1, padding:"10px", borderRadius:12, border:"1px solid #e8e6e0", background:"#fff" }}>{t("actions.cancel")}</button>
              <button onClick={addPetDeadline} style={{ flex:1, padding:"10px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", fontWeight:700 }}>{t("actions.confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Pet Docs modal */}
      {showPetDocModal && (
        <div onClick={e => e.target === e.currentTarget && setShowPetDocModal(false)} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.55)", zIndex:210,
          display:"flex", alignItems:"flex-start", justifyContent:"center", backdropFilter:"blur(4px)",
          padding:"6vh 0 20px"
        }}>
          <div style={{ width:"90%", maxWidth:380, background:"#fff", borderRadius:18, padding:"18px", maxHeight:"85vh", overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch" }}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:12 }}>{t("pet.addDoc")}</div>
            {petDocsFiles.map((f, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#f7f6f2", padding:"6px 8px", borderRadius:8, marginBottom:6 }}>
                <div style={{ fontSize:12 }}>{f.name}</div>
                <button onClick={() => setPetDocsFiles(petDocsFiles.filter((_, idx) => idx !== i))} style={{ border:"none", background:"transparent", color:"#E53935", cursor:"pointer" }}>{t("actions.remove")}</button>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <label style={{ flex:1, padding:"10px", borderRadius:12, border:"2px dashed #e8e6e0", textAlign:"center", cursor:"pointer", fontWeight:700, fontSize:12, color:"#6b6961" }}>
                {t("attachments.upload")}
                <input type="file" accept="image/*,application/pdf,*/*" style={{ display:"none" }} onChange={e => setPetDocsFiles(mergeFiles(petDocsFiles, e.target.files))} />
              </label>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowPetDocModal(false)} style={{ flex:1, padding:"10px", borderRadius:12, border:"1px solid #e8e6e0", background:"#fff" }}>{t("actions.cancel")}</button>
              <button onClick={addPetDocs} style={{ flex:1, padding:"10px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", fontWeight:700 }}>{t("actions.confirm")}</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Payment Flow Modal */}
      <PaymentFlowModal
        open={paymentFlow !== null}
        item={paymentFlow ? activeDeadlines.find(d => d.id === paymentFlow.itemId) : null}
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
              style={{ ...dateInpModal, marginBottom:16 }}
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

      {showFilters && (
        <div onClick={() => setShowFilters(false)} style={{
          position:"fixed", inset:0, background:"rgba(18,17,13,.6)", zIndex:220,
          display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#fff", borderRadius:"24px 24px 0 0", padding:"0 0 20px", width:"100%", maxWidth:480,
            animation:"sheetUp .28s cubic-bezier(.34,1.56,.64,1) both", maxHeight:"70vh", overflowY:"auto",
          }}>
            <style>{`@keyframes sheetUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
            <div style={{ width:44, height:5, background:"#e0ddd6", borderRadius:3, margin:"12px auto 10px" }}/>
            <div style={{ padding:"0 14px 6px", fontSize:12, color:"#8a877f", fontWeight:800, textTransform:"uppercase", letterSpacing:".5px" }}>Filtri</div>
            <PriorityFilter
              activeTab={activeTab}
              filterMandatory={filterMandatory}
              setFilterMandatory={setFilterMandatory}
              filterAutoPay={filterAutoPay}
              setFilterAutoPay={setFilterAutoPay}
              filterManual={filterManual}
              setFilterManual={setFilterManual}
              filterEstimateMissing={filterEstimateMissing}
              setFilterEstimateMissing={setFilterEstimateMissing}
              filterPet={filterPet}
              setFilterPet={setFilterPet}
            />
            <div style={{ padding:"0 14px 10px" }}>
              <button onClick={() => setShowFilters(false)} style={{
                width:"100%", padding:"12px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff",
                fontSize:13, fontWeight:700, cursor:"pointer"
              }}>{t("actions.close")}</button>
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
          {(() => {
            const docSrc = viewingDoc.url || viewingDoc.base64;
            const isImage = viewingDoc.isImage ?? (viewingDoc.contentType?.startsWith("image/") || (docSrc || "").startsWith("data:image/"));
            return (
              <>
                <div style={{ fontSize:14, fontWeight:600, color:"#fff", marginBottom:16, maxWidth:"90%", textAlign:"center" }}>{viewingDoc.filename}</div>
                {isImage ? (
                  <img src={docSrc} style={{ maxWidth:"100%", maxHeight:"70vh", borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,.5)" }} alt="Document" />
                ) : (
                  <div style={{ padding:"30px 40px", borderRadius:14, background:"rgba(255,255,255,.08)", color:"#fff", fontSize:14, fontWeight:700 }}>
                    {t("docs.previewUnavailable")}
                  </div>
                )}
              </>
            );
          })()}
          <div style={{ display:"flex", gap:10, marginTop:18, flexWrap:"wrap", justifyContent:"center" }}>
            <a
              href={viewingDoc.url || viewingDoc.base64}
              target="_blank"
              rel="noreferrer"
              style={{ padding:"12px 18px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", fontSize:13, fontWeight:700, textDecoration:"none", cursor:"pointer" }}
              onClick={e => e.stopPropagation()}
            >
              {t("actions.open")}
            </a>
            <a
              href={viewingDoc.url || viewingDoc.base64}
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
