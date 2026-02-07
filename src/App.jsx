import { useState, useMemo, useRef, useEffect } from "react";
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore/lite';

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
const DEFAULT_CATS = [
  { id:"casa",     label:"Casa",      icon:"🏠", color:"#E8855D", light:"#FFF0EC", assets:["Colico", "Monza"] },
  { id:"auto",     label:"Auto",      icon:"🚗", color:"#5B8DD9", light:"#EBF2FC", assets:["Micro", "Sym 125"] },
  { id:"famiglia", label:"Famiglia",  icon:"👨‍👩‍👧", color:"#C77DBA", light:"#F8EEF7", assets:[] },
  { id:"finanze",  label:"Finanze",   icon:"💰", color:"#4CAF6E", light:"#EDFBF2", assets:[] },
  { id:"salute",   label:"Salute",    icon:"🏥", color:"#F0B84D", light:"#FFF8ED", assets:[] },
  { id:"scuola",   label:"Scuola",    icon:"📚", color:"#7B8BE8", light:"#F0F2FD", assets:[] },
];

const getCat = (cats, id) => cats.find(c => c.id === id) || cats[0];

// Format currency without decimals (fix #1)
const formatCurrency = (amount) => `€${Math.round(amount)}`;

const TODAY = new Date(); TODAY.setHours(0,0,0,0);
function addDays(n) { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; }

const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const MONTHS_SHORT = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

/* ── DOCUMENT HELPERS ──────────────────────────────────── */
// Compress and convert image to base64
async function compressImage(file, maxWidth = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── DATI FAKE RIMOSSI - App vuota per uso reale ──────────────────────────────────── */


/* ── TIME RANGES ───────────────────────────────────────── */
const RANGES = [
  { id:"settimana",  label:"Settimana",  days:7   },
  { id:"mese",       label:"Mese",       days:30  },
  { id:"trimestre",  label:"Trimestre",  days:90  },
  { id:"semestre",   label:"Semestre",   days:180 },
  { id:"anno",       label:"Anno",       days:365 },
];

/* ── GROUPING LOGIC ────────────────────────────────────── */
function getGroupKey(date, range) {
  const y = date.getFullYear(), m = date.getMonth();
  switch(range) {
    case "settimana": {
      const diff = Math.floor((date - TODAY) / 86400000);
      const w = Math.floor(diff / 7);
      return { key: `w${w}`, label: w === 0 ? "Questa settimana" : w === 1 ? "Prossima settimana" : `Settimana +${w}`, order: w };
    }
    case "mese":
      return { key: `${y}-${m}`, label: `${MONTHS_IT[m]} ${y}`, order: y * 12 + m };
    case "trimestre": {
      const q = Math.floor(m / 3);
      return { key: `${y}-Q${q}`, label: `Q${q+1} ${y}`, order: y * 4 + q };
    }
    case "semestre": {
      const s = m < 6 ? 0 : 1;
      return { key: `${y}-S${s}`, label: s === 0 ? `1° semestre ${y}` : `2° semestre ${y}`, order: y * 2 + s };
    }
    case "anno":
      return { key: `${y}`, label: `${y}`, order: y };
    default:
      return { key: "all", label: "Tutte", order: 0 };
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
function diffDays(d) { return Math.round((d - TODAY) / 86400000); }
function fmtDate(d) { return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; }

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

function getUrgency(date, done) {
  if (done) return { color:"#aaa", bg:"#f0efe8", label:"Fatto" };
  const days = diffDays(date);
  if (days < 0)  return { color:"#E53935", bg:"#FFEBEE", label:"Scaduta" };
  if (days === 0) return { color:"#E53935", bg:"#FFEBEE", label:"Oggi" };
  if (days <= 3)  return { color:"#F4511E", bg:"#FBE9E7", label:`${days}g` };
  if (days <= 7)  return { color:"#FB8C00", bg:"#FFF3E0", label:`${days}g` };
  return               { color:"#4CAF6E", bg:"#E8F5E9", label:`${days}g` };
}

/* ── COMPONENTI ────────────────────────────────────────── */

/* Range Selector */
function RangeSelector({ active, onChange }) {
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
          }}>{r.label}</button>
        );
      })}
    </div>
  );
}

/* Budget summary bar */
function BudgetBar({ deadlines, range, cats }) {
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
            <div style={{ fontSize:10, color:"rgba(255,255,255,.4)", fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>Budget nel periodo</div>
            <div style={{ fontSize:28, fontWeight:800, color:"#fff", letterSpacing:"-1px", marginTop:1, fontFamily:"'Sora',sans-serif" }}>{formatCurrency(total)}</div>
            {missingCount > 0 && (
              <div style={{ marginTop:4, fontSize:10, color:"rgba(255,255,255,.45)" }}>⚠ {missingCount} da stimare</div>
            )}
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,.35)", fontWeight:700, textTransform:"uppercase" }}>Scadenze</div>
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
  const cat = getCat(cats, item.cat);
  const urg = getUrgency(item.date, item.done);
  const days = diffDays(item.date);

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
              {cat.label}
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
              <div style={{ fontSize:9, color:"#8a877f", fontWeight:700, textTransform:"uppercase", letterSpacing:".4px" }}>Scadenza</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#2d2b26", marginTop:2 }}>{fmtDate(item.date)}</div>
            </div>
            <div style={{ flex:1, minWidth:80, background:"#faf9f7", borderRadius:10, padding:"8px 10px" }}>
              <div style={{ fontSize:9, color:"#8a877f", fontWeight:700, textTransform:"uppercase", letterSpacing:".4px" }}>Budget</div>
              <div style={{ fontSize:14, fontWeight:700, color: item.estimateMissing ? "#8a6d1f" : (item.budget > 0 ? "#4CAF6E" : "#aaa"), marginTop:2 }}>
                {item.estimateMissing ? "Da stimare" : (item.budget > 0 ? `€${item.budget}` : "—")}
              </div>
            </div>
            <div style={{ flex:1, minWidth:80, background:"#faf9f7", borderRadius:10, padding:"8px 10px" }}>
              <div style={{ fontSize:9, color:"#8a877f", fontWeight:700, textTransform:"uppercase", letterSpacing:".4px" }}>Ripete</div>
              <div style={{ fontSize:13, fontWeight:600, color:"#2d2b26", marginTop:2 }}>
                {item.recurring && item.recurring.enabled ? (
                  `${item.recurring.index}/${item.recurring.total} (ogni ${item.recurring.interval} ${item.recurring.unit})`
                ) : (
                  "Mai più"
                )}
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
              ⚠ Scadenza inderogabile
            </div>
          )}

          {item.autoPay && !item.done && (
            <div style={{ fontSize:11, color:"#5B8DD9", background:"#EBF2FC", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              🔄 Pagamento automatico attivo
            </div>
          )}

          {item.autoCompleted && item.done && (
            <div style={{ fontSize:11, color:"#4CAF6E", background:"#E8F5E9", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              ✓ Completata automaticamente alla scadenza
            </div>
          )}

          {item.skipped && item.done && (
            <div style={{ fontSize:11, color:"#6b6961", background:"#f0efe8", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              ⏭ Scadenza saltata
            </div>
          )}

          {item.estimateMissing && !item.done && (
            <div style={{ fontSize:11, color:"#8a6d1f", background:"#FFF8ED", borderRadius:10, padding:"8px 10px", marginBottom:12, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <span>💡 Stima mancante</span>
              <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"#2d2b26", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                Aggiungi stima
              </button>
            </div>
          )}

          {/* Documents section */}
          {((item.documents && item.documents.length > 0) || !item.done) && (
            <div style={{ background:"#faf9f7", borderRadius:10, padding:"8px 10px", marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#8a877f", fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>📎 Documenti</div>
              
              {item.documents && item.documents.length > 0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:6 }}>
                  {item.documents.map(doc => (
                    <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", borderRadius:8, padding:"6px 8px", border:"1px solid #e8e6e0" }}>
                      <span style={{ fontSize:16 }}>{doc.type === 'receipt' ? '🧾' : '📄'}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{doc.filename}</div>
                        <div style={{ fontSize:9, color:"#8a877f" }}>{doc.type === 'receipt' ? 'Ricevuta' : 'Documento'}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); onViewDoc(doc); }} style={{ padding:"3px 7px", borderRadius:6, border:"none", background:"#EBF2FC", color:"#5B8DD9", fontSize:10, fontWeight:600, cursor:"pointer" }}>Vedi</button>
                      <button onClick={(e) => { e.stopPropagation(); if(window.confirm("Eliminare documento?")) onDeleteDoc(item.id, doc.id); }} style={{ padding:"3px 6px", borderRadius:6, border:"none", background:"#FFF0EC", color:"#E53935", fontSize:11, fontWeight:600, cursor:"pointer", lineHeight:1 }}>✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize:10, color:"#b5b2a8", fontStyle:"italic", marginBottom:6 }}>Nessun documento allegato</div>
              )}
              
              {/* Upload buttons - più compatti */}
              {!item.done && (
                <label style={{ display:"block", padding:"7px", borderRadius:8, border:"1px dashed #e8e6e0", background:"#fff", color:"#6b6961", fontSize:11, fontWeight:600, cursor:"pointer", textAlign:"center", minHeight:32 }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={(e) => { if(e.target.files[0]) onUploadDoc(item.id, 'incoming', e.target.files[0]); e.target.value=''; }} />
                  📸 Allega documento
                </label>
              )}
              {item.done && (
                <label style={{ display:"block", padding:"7px", borderRadius:8, border:"1px dashed #4CAF6E44", background:"#E8F5E9", color:"#4CAF6E", fontSize:11, fontWeight:600, cursor:"pointer", textAlign:"center", minHeight:32 }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={(e) => { if(e.target.files[0]) onUploadDoc(item.id, 'receipt', e.target.files[0]); e.target.value=''; }} />
                  🧾 Allega ricevuta
                </label>
              )}
            </div>
          )}

          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} style={{
              flex:1, padding:"11px", borderRadius:10, border:"2px solid #5B8DD9",
              background:"#EBF2FC", color:"#5B8DD9", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>✏️ Modifica</button>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            {/* Se è scaduta, offri "Posticipa" */}
            {days < 0 && !item.done && (
              <button onClick={(e) => { e.stopPropagation(); onPostpone(item.id); }} style={{
                flex:1, padding:"11px", borderRadius:10, border:"none",
                background:"#FB8C00", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
              }}>↻ Posticipa</button>
            )}

            {item.recurring && item.recurring.enabled && !item.done && (
              <button onClick={(e) => { e.stopPropagation(); onSkip(item.id); }} style={{
                flex:1, padding:"11px", borderRadius:10, border:"none",
                background:"#edecea", color:"#6b6961", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
              }}>⏭ Salta</button>
            )}
            
            <button onClick={(e) => { e.stopPropagation(); onComplete(item.id); }} style={{
              flex: days < 0 && !item.done ? 1 : 2, padding:"11px", borderRadius:10, border:"none",
              background: item.done ? "#edecea" : cat.color,
              color: item.done ? "#6b6961" : "#fff",
              fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>{item.done ? "↩ Riattiva" : "✓ Completata"}</button>
            
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} style={{
              flex:1, padding:"11px", borderRadius:10, border:"none",
              background:"#FFF0EC", color:"#E53935", fontSize:14, fontWeight:700, cursor:"pointer", minHeight:44,
            }}>Elimina</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Smart Category Filter with asset sub-filters */
function CategoryFilter({ cats, deadlines, filterCat, filterAsset, expandedCat, onSelectCat, onSelectAsset, onToggleExpand, activeTab, maxDays, filterMandatory, setFilterMandatory, filterRecurring, setFilterRecurring, filterAutoPay, setFilterAutoPay, filterEssential, setFilterEssential }) {
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
        }}>Tutte</button>
        
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
              {c.icon} {c.label}
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
              }}>Tutti</button>
              
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
        }}>⚠ Inderogabili</button>

        <button onClick={() => setFilterRecurring(!filterRecurring)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterRecurring ? "#EBF2FC" : "#edecea",
          color: filterRecurring ? "#5B8DD9" : "#8a877f",
          border: `1.5px solid ${filterRecurring ? "#5B8DD955" : "transparent"}`,
          minHeight:32,
        }}>🔁 Ricorrenti</button>

        <button onClick={() => setFilterAutoPay(!filterAutoPay)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterAutoPay ? "#EBF2FC" : "#edecea",
          color: filterAutoPay ? "#5B8DD9" : "#8a877f",
          border: `1.5px solid ${filterAutoPay ? "#5B8DD955" : "transparent"}`,
          minHeight:32,
        }}>🔄 Automatici</button>

        <button onClick={() => setFilterEssential(!filterEssential)} style={{
          flexShrink:0, borderRadius:14, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700,
          background: filterEssential ? "#EDFBF2" : "#edecea",
          color: filterEssential ? "#4CAF6E" : "#8a877f",
          border: `1.5px solid ${filterEssential ? "#4CAF6E55" : "transparent"}`,
          minHeight:32,
        }}>💡 Essenziali</button>
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
            <div style={{ fontSize:13, color:"#8a877f", marginBottom:20 }}>Budget previsto: <strong>€{item.budget}</strong></div>

            {/* Big button: Pagata per intero */}
            <button onClick={() => onConfirm('full')} style={{
              width:"100%", padding:"16px", borderRadius:14, border:"none",
              background:"#4CAF6E", color:"#fff", cursor:"pointer", fontSize:16, fontWeight:700,
              marginBottom:12, boxShadow:"0 4px 14px rgba(76,175,110,.25)", minHeight:56,
            }}>✓ Pagata €{item.budget}</button>

            {/* Secondary options */}
            <button onClick={() => onChangeStep('downpayment')} style={{
              width:"100%", padding:"14px", borderRadius:12, border:"2px solid #e8e6e0",
              background:"#fff", color:"#2d2b26", cursor:"pointer", fontSize:14, fontWeight:600,
              marginBottom:8, minHeight:48,
            }}>💰 Ho pagato un acconto</button>

            <button onClick={() => onChangeStep('partial')} style={{
              width:"100%", padding:"14px", borderRadius:12, border:"2px solid #e8e6e0",
              background:"#fff", color:"#2d2b26", cursor:"pointer", fontSize:14, fontWeight:600,
              marginBottom:8, minHeight:48,
            }}>✏ Importo diverso</button>

            <button onClick={() => onConfirm('not_paid')} style={{
              width:"100%", padding:"14px", borderRadius:12, border:"2px solid #FBE9E7",
              background:"#FFF0EC", color:"#E53935", cursor:"pointer", fontSize:14, fontWeight:600,
              minHeight:48,
            }}>✗ Non pagata</button>
          </>
        )}

        {step === 'partial' && (
          <>
            <h3 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>Importo pagato</h3>
            <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6, textTransform:"uppercase" }}>Quanto hai pagato?</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={String(item.budget)}
              autoFocus
              style={{ width:"100%", padding:"14px 16px", borderRadius:12, border:"2px solid #edecea", fontSize:18, fontWeight:700, outline:"none", marginBottom:20, textAlign:"center" }}
            />
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:"14px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>Annulla</button>
              <button onClick={() => onConfirm('partial')} style={{ flex:2, padding:"14px", borderRadius:12, border:"none", background:"#4CAF6E", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 }}>Conferma</button>
            </div>
          </>
        )}

        {step === 'downpayment' && (
          <>
            <h3 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>Pagamento acconto</h3>
            
            <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6, textTransform:"uppercase" }}>Quanto hai pagato ora?</label>
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
                <div style={{ fontSize:12, color:"#5B8DD9", fontWeight:600 }}>Saldo rimanente: €{item.budget - Number(amount)}</div>
              </div>
            )}

            <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:6, textTransform:"uppercase" }}>Quando scade il saldo?</label>
            <input
              type="date"
              value={downpaymentDate}
              onChange={e => setDownpaymentDate(e.target.value)}
              style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #edecea", fontSize:14, outline:"none", marginBottom:20 }}
            />

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:"14px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>Annulla</button>
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
              >Crea saldo</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddSheet({ open, onClose, onSave, onUpdate, cats, presetAsset, editingItem }) {
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
  const steps = ["Documento", "Dettagli", "Ricorrenza", "Opzioni"];
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
  const autoEndLabel = getAutoEndDate().toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' });
  const unitSingular = ({
    giorni: "giorno",
    settimane: "settimana",
    mesi: "mese",
    anni: "anno",
  })[form.recurringUnit] || form.recurringUnit;
  const frequencyLabel = form.recurringPreset === "mensile"
    ? "ogni mese"
    : form.recurringPreset === "trimestrale"
      ? "ogni 3 mesi"
      : form.recurringPreset === "annuale"
        ? "ogni anno"
        : (interval === 1 ? `ogni ${unitSingular}` : `ogni ${interval} ${form.recurringUnit}`);
  const endDateLabel = form.recurringEndDate
    ? new Date(form.recurringEndDate + "T00:00:00").toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' })
    : "";
  const endSummary = form.recurringEndMode === "auto"
    ? `continua (mostriamo fino al ${autoEndLabel})`
    : form.recurringEndMode === "date"
      ? (endDateLabel ? `fino al ${endDateLabel}` : "fino alla data scelta")
      : `per ${count} volte`;
  const presetOptions = [
    { id:"mensile", label:"Mensile", interval:1, unit:"mesi" },
    { id:"trimestrale", label:"Trimestrale", interval:3, unit:"mesi" },
    { id:"annuale", label:"Annuale", interval:1, unit:"anni" },
    { id:"custom", label:"Personalizzata" },
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
          {editingItem ? "Modifica scadenza" : "Nuova scadenza"}
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
            {form.title ? form.title : "Senza titolo"}
            {form.date ? ` · ${form.date}` : ""}
            {form.budget ? ` · €${form.budget}` : ""}
          </div>
        </div>

        {step === 0 && (
          <>
            <label style={lbl}>Documento (opzionale)</label>
            <div style={{ background:"#faf9f7", borderRadius:12, padding:"10px 12px", border:"1px solid #edecea" }}>
              {form.documents.length === 0 ? (
                <label style={{ display:"block", padding:"10px", borderRadius:10, border:"1px dashed #e8e6e0", background:"#fff", color:"#8a877f", fontSize:12, fontWeight:600, cursor:"pointer", textAlign:"center", minHeight:44 }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={async (e) => {
                    if(e.target.files[0]) {
                      try {
                        const base64 = await compressImage(e.target.files[0]);
                        const doc = { id: Date.now(), type: 'incoming', base64, filename: e.target.files[0].name, uploadDate: new Date().toISOString() };
                        set("documents", [doc]);
                      } catch(err) { alert("Errore caricamento file"); }
                      e.target.value = '';
                    }
                  }} />
                  📸 Carica il documento (puoi saltare)
                </label>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:8, background:"#fff", borderRadius:8, padding:"6px 10px", border:"1px solid #e8e6e0" }}>
                  <span style={{ fontSize:16 }}>📄</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"#2d2b26", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{form.documents[0].filename}</div>
                    <div style={{ fontSize:10, color:"#8a877f" }}>Documento allegato</div>
                  </div>
                  <button type="button" onClick={() => set("documents", [])} style={{ padding:"4px 8px", borderRadius:6, border:"none", background:"#FFF0EC", color:"#E53935", fontSize:11, fontWeight:600, cursor:"pointer" }}>Rimuovi</button>
                </div>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <label style={lbl}>Titolo</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Es. Rinnovo assicurazione" style={inp} autoFocus/>

            <label style={lbl}>Categoria</label>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
              {cats.map(c => (
                <button key={c.id} onClick={() => { set("cat", c.id); set("asset", null); }} style={{
                  background: form.cat === c.id ? c.light : "#f5f4f0",
                  border: `2px solid ${form.cat === c.id ? c.color : "transparent"}`,
                  borderRadius:12, padding:"8px 12px", cursor:"pointer", fontSize:13,
                  fontWeight: form.cat === c.id ? 700 : 500,
                  color: form.cat === c.id ? c.color : "#6b6961",
                  minHeight:44,
                }}>{c.icon} {c.label}</button>
              ))}
            </div>

            {hasAssets && (
              <>
                <label style={lbl}>Per quale?</label>
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

            <label style={lbl}>Data scadenza</label>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={inp}/>

            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1 }}>
                <label style={lbl}>Budget (€)</label>
                <input type="number" value={form.budget} onChange={e => set("budget", e.target.value)} placeholder="0" style={inp}/>
                <div style={{ fontSize:11, color:"#8a877f", marginTop:6 }}>
                  Se non sai l'importo puoi lasciarlo vuoto: non entrerà nei totali.
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
                  <div style={{ fontSize:13, fontWeight:700, color:"#2d2b26" }}>🔁 Scadenza ricorrente</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>Genera automaticamente più occorrenze</div>
                </div>
              </label>

              {form.recurringEnabled && (
                <div style={{ paddingLeft:4 }}>
                  <div style={{ fontSize:11, color:"#8a877f", fontWeight:700, marginBottom:6 }}>Frequenza</div>
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
                    <div style={{ fontWeight:700, color:"#2d2b26" }}>Ripete {frequencyLabel}</div>
                    <div style={{ marginTop:4, color:"#8a877f" }}>{endSummary}</div>
                  </div>

                  <button
                    onClick={() => setShowAdvanced(v => !v)}
                    style={{ marginTop:10, background:"transparent", border:"none", color:"#5B8DD9", fontSize:12, fontWeight:700, cursor:"pointer" }}
                  >
                    {showAdvanced ? "Nascondi avanzate" : "Avanzate"}
                  </button>

                  {showAdvanced && (
                    <div style={{ marginTop:8, background:"#fff", border:"1px solid #edecea", borderRadius:10, padding:"10px" }}>
                      {form.recurringPreset === "custom" && (
                        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
                          <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, minWidth:70 }}>Ogni</label>
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

                      <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, display:"block", marginBottom:6 }}>Fine serie</label>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                        {[
                          { id:"auto", label:"Senza fine" },
                          { id:"count", label:"Dopo N" },
                          { id:"date", label:"Fino al" },
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
                          <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, minWidth:70 }}>Ripetizioni</label>
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
                          <label style={{ fontSize:11, color:"#8a877f", fontWeight:700, minWidth:70 }}>Fino al</label>
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
                      ? `💡 Verranno create ${totalOccurrences || count} scadenze (importo da stimare)`
                      : `💡 Verranno create ${totalOccurrences || count} scadenze con €${form.budget} ciascuna`
                    }
                  </div>
                </div>
              )}
            </div>

            {preview && (
              <div style={{ marginTop:12, background:"#2d2b26", color:"#fff", borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:10, opacity:.6, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px" }}>
                  Impatto economico
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginTop:6, gap:12 }}>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800 }}>{budgetMissing ? "—" : formatCurrency(preview.thisYearTotal)}</div>
                    <div style={{ fontSize:10, opacity:.6 }}>quest'anno · {preview.thisYearCount} scadenze</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:18, fontWeight:800 }}>{budgetMissing ? "—" : formatCurrency(preview.nextYearTotal)}</div>
                    <div style={{ fontSize:10, opacity:.6 }}>anno {preview.nextYear} · {preview.nextYearCount} scadenze</div>
                    {preview.next && (
                      <div style={{ fontSize:10, opacity:.6 }}>
                        prossima {preview.next.toLocaleDateString('it-IT', { day:'2-digit', month:'short' })}
                      </div>
                    )}
                  </div>
                </div>
                {budgetMissing && (
                  <div style={{ marginTop:6, fontSize:10, opacity:.6 }}>
                    Aggiungi una stima per calcolare l'impatto
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
                  <div style={{ fontSize:13, fontWeight:700, color:"#E53935" }}>⚠ Scadenza inderogabile</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>Es. tasse, multe, documenti legali</div>
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
                  <div style={{ fontSize:13, fontWeight:700, color:"#4CAF6E" }}>💡 Spesa essenziale</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>Necessaria per vita quotidiana (bollette, spesa, affitto)</div>
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
                  <div style={{ fontSize:13, fontWeight:700, color:"#5B8DD9" }}>🔄 Pagamento automatico</div>
                  <div style={{ fontSize:11, color:"#8a877f", marginTop:2 }}>Domiciliazione bancaria o addebito automatico</div>
                </div>
              </label>
            </div>

            <label style={lbl}>Note</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Appunti…" rows={2} style={{ ...inp, resize:"vertical" }}/>
          </>
        )}

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:"14px", borderRadius:14, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961", minHeight:48 }}>Annulla</button>
          {step > 0 && (
            <button onClick={() => setStep(s => Math.max(0, s - 1))} style={{ flex:1, padding:"14px", borderRadius:14, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, color:"#2d2b26", minHeight:48 }}>
              Indietro
            </button>
          )}
          {step < lastStep ? (
            <>
              {step === 0 && (
                <button onClick={() => setStep(s => Math.min(lastStep, s + 1))} style={{
                  flex:1, padding:"14px", borderRadius:14, border:"2px solid #e8e6e0", background:"#fff", color:"#6b6961", cursor:"pointer", fontSize:14, fontWeight:600, minHeight:48
                }}>Salta</button>
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
                Avanti
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
            }}>Aggiungi</button>
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
      month: monthStart.toLocaleDateString('it-IT', { month: 'short' }),
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
      month: monthStart.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' }),
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
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>📈 Statistiche</h2>
          <button onClick={onClose} style={{ fontSize:24, background:"none", border:"none", cursor:"pointer", color:"#8a877f", padding:0 }}>×</button>
        </div>

        {/* Tabs Anno/Futuro */}
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          {[
            { id:"anno", label:"📈 Anno " + currentYear },
            { id:"futuro", label:"🔮 Prossimi 12 mesi" }
          ].map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              flex:1, padding:"10px", borderRadius:10, border:"none", cursor:"pointer", fontSize:12, fontWeight:700,
              background: view === t.id ? "#2d2b26" : "#f5f4f0",
              color: view === t.id ? "#fff" : "#6b6961",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ═══════════ TAB: ANNO CORRENTE ═══════════ */}
        {view === "anno" && (
          <div>
            {/* Card principale */}
            <div style={{ background:"linear-gradient(135deg, #667eea 0%, #764ba2 100%)", borderRadius:16, padding:"20px", marginBottom:20, color:"#fff" }}>
              <div style={{ fontSize:11, fontWeight:700, opacity:0.8, marginBottom:4 }}>SPESE {currentYear}</div>
              <div style={{ fontSize:36, fontWeight:800, fontFamily:"'Sora',sans-serif", marginBottom:8 }}>€{currentYearTotal.toLocaleString()}</div>
              {yearChange !== null && (
                <div style={{ fontSize:13, opacity:0.9 }}>
                  {yearChange >= 0 ? "↑" : "↓"} {Math.abs(yearChange)}% vs {previousYear} (€{prevYearTotal.toLocaleString()})
                </div>
              )}
              <div style={{ fontSize:12, marginTop:8, opacity:0.8 }}>{currentYearCount} scadenze completate</div>
            </div>

            {/* Insights */}
            <div style={{ background:"#FFF8ED", borderRadius:12, padding:"14px 16px", marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#F0B84D", marginBottom:8 }}>💡 INSIGHTS</div>
              <div style={{ fontSize:12, color:"#2d2b26", lineHeight:1.6 }}>
                • Spesa media mensile: <strong>€{avgMonthly.toFixed(0)}</strong><br/>
                {topCat && `• Categoria più costosa: ${topCat.cat.icon} ${topCat.cat.label} (${topCat.percentage}%)`}<br/>
                {peakMonth && `• Picco di spesa: ${peakMonth.month} (€${Math.round(peakMonth.total)})`}
              </div>
            </div>

            {/* Breakdown categorie */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>📊 Breakdown per categoria</div>
              {categoryBreakdown.map(({ cat, total, count, percentage }) => (
                <div key={cat.id} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:18 }}>{cat.icon}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:"#2d2b26" }}>{cat.label}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:"#8a877f" }}>{count}</span>
                      <span style={{ fontSize:15, fontWeight:800, color:cat.color }}>€{total}</span>
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
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>📅 Trend mensile</div>
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
                      <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>€{total}</span>
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
              <div style={{ fontSize:11, fontWeight:700, opacity:0.8, marginBottom:4 }}>PROSSIMI 12 MESI</div>
              <div style={{ fontSize:36, fontWeight:800, fontFamily:"'Sora',sans-serif", marginBottom:8 }}>€{futureTotal.toLocaleString()}</div>
              <div style={{ fontSize:12, marginTop:8, opacity:0.9 }}>
                {futureCount} scadenze attive • {futureRecurring} ricorrenti • {futureAutoPay} domiciliate
              </div>
            </div>

            {/* Insights */}
            <div style={{ background:"#EBF2FC", borderRadius:12, padding:"14px 16px", marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#5B8DD9", marginBottom:8 }}>💡 INSIGHTS</div>
              <div style={{ fontSize:12, color:"#2d2b26", lineHeight:1.6 }}>
                {futurePeakMonth && `• Mese più impegnativo: ${futurePeakMonth.month} (€${Math.round(futurePeakMonth.total)})`}<br/>
                • {next30DaysCount} scadenze nei prossimi 30 giorni<br/>
                • Spesa media mensile prevista: <strong>€{(futureTotal / 12).toFixed(0)}</strong>
              </div>
            </div>

            {/* Breakdown categorie */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>📊 Breakdown per categoria</div>
              {futureCategoryBreakdown.map(({ cat, total, count, percentage }) => (
                <div key={cat.id} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:18 }}>{cat.icon}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:"#2d2b26" }}>{cat.label}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:"#8a877f" }}>{count}</span>
                      <span style={{ fontSize:15, fontWeight:800, color:cat.color }}>€{total}</span>
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
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>📅 Prossimi mesi</div>
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
                      <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>€{total}</span>
                    </div>
                  </div>
                  <div style={{ fontSize:10, color:"#8a877f", width:25 }}>{count}×</div>
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
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>🏷️ I miei Asset</h2>
          <button onClick={onClose} style={{ fontSize:24, background:"none", border:"none", cursor:"pointer", color:"#8a877f", padding:0 }}>×</button>
        </div>

        {!hasAssets ? (
          <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🏷️</div>
            <div style={{ fontSize:16, fontWeight:600, color:"#8a877f", marginBottom:8 }}>Nessun asset configurato</div>
            <div style={{ fontSize:13, color:"#b5b2a8", lineHeight:1.6 }}>
              Aggiungi asset alle categorie nelle impostazioni (⚙️) per tracciare spese specifiche per auto, case, etc.
            </div>
          </div>
        ) : (
          assetsByCategory.map(({ cat, assets }) => (
            <div key={cat.id} style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:16 }}>{cat.icon}</span>
                {cat.label}
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
                        {asset.deadlines} scadenze • {asset.completed} completate
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:16, fontWeight:800, color:cat.color }}>€{asset.totalSpent}</div>
                      <div style={{ fontSize:10, color:"#8a877f" }}>totale</div>
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
  const [tab, setTab] = useState("panoramica");
  const [showAddWork, setShowAddWork] = useState(false);
  const [editingWorkLog, setEditingWorkLog] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  if (!open) return null;

  const cat = cats.find(c => c.id === catId);
  if (!cat) return null;

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
            <div style={{ fontSize:12, color:"#8a877f", marginTop:2 }}>{cat.label}</div>
          </div>
          <button onClick={onClose} style={{ fontSize:24, background:"none", border:"none", cursor:"pointer", color:"#8a877f", padding:0 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:6, marginBottom:20, borderBottom:"2px solid #f5f4f0" }}>
          {[
            { id:"panoramica", label:"📋 Overview" },
            { id:"scadenze", label:"📅 Scadenze" },
            { id:"registro", label:"🔧 Registro" }
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex:1, padding:"10px 8px", background:"none", border:"none", cursor:"pointer",
              fontSize:12, fontWeight:700, color: tab === t.id ? "#2d2b26" : "#8a877f",
              borderBottom: tab === t.id ? "2px solid #2d2b26" : "2px solid transparent",
              marginBottom:"-2px", transition:"all .2s"
            }}>{t.label}</button>
          ))}
        </div>

        {/* TAB: PANORAMICA */}
        {tab === "panoramica" && (
          <div>
            {/* Stats card */}
            <div style={{ background:"#f5f4f0", borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
              <div style={{ fontSize:11, color:"#8a877f", fontWeight:700, marginBottom:4 }}>TOTALE SPESO</div>
              <div style={{ fontSize:28, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>€{totalSpent}</div>
              <div style={{ fontSize:12, color:"#6b6961", marginTop:4 }}>
                {completed.length} scadenze • {assetWorkLogs.length} lavori registrati
              </div>
            </div>

            {/* Prossime scadenze */}
            {upcoming.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>📅 Prossime Scadenze</div>
                {upcoming.sort((a, b) => a.date - b.date).slice(0, 3).map(d => (
                  <div key={d.id} style={{ background:"#EBF2FC", borderRadius:8, padding:"8px 10px", marginBottom:6, border:"1px solid #5B8DD966" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:"#2d2b26" }}>{d.title}</div>
                        <div style={{ fontSize:10, color:"#8a877f", marginTop:2 }}>{d.date.toLocaleDateString('it-IT')}</div>
                      </div>
                      <div style={{ fontSize:14, fontWeight:800, color:"#5B8DD9" }}>€{d.budget}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Ultimi lavori */}
            {assetWorkLogs.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>🔧 Ultimi Lavori</div>
                {assetWorkLogs.slice(0, 2).map(log => (
                  <div key={log.id} style={{ background:"#faf9f7", borderRadius:8, padding:"8px 10px", marginBottom:6, border:"1px solid #e8e6e0" }}>
                    <div style={{ fontSize:12, fontWeight:700, color:"#2d2b26" }}>{log.title}</div>
                    <div style={{ fontSize:10, color:"#8a877f", marginTop:2 }}>
                      {log.date.toLocaleDateString('it-IT')}
                      {log.km && ` • ${log.km.toLocaleString()} km`}
                      {log.cost > 0 && ` • €${log.cost}`}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Documenti */}
            {allDocuments.length > 0 && (
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:8, textTransform:"uppercase" }}>📎 Documenti ({allDocuments.length})</div>
                {allDocuments.slice(0, 3).map(doc => (
                  <div key={doc.id} onClick={() => onViewDoc(doc)} style={{ background:"#faf9f7", borderRadius:8, padding:"6px 8px", marginBottom:4, fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                    <span>{doc.type === 'receipt' ? '🧾' : '📄'}</span>
                    <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{doc.filename}</span>
                  </div>
                ))}
                {allDocuments.length > 3 && (
                  <div style={{ fontSize:10, color:"#8a877f", textAlign:"center", marginTop:4 }}>
                    +{allDocuments.length - 3} altri
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
                <span style={{ fontSize:16 }}>+</span> Aggiungi scadenza per {assetName}
              </button>
            </div>

            <div style={{ background:"#f5f4f0", borderRadius:10, padding:"10px 12px", marginBottom:12, fontSize:11, color:"#6b6961" }}>
              {assetDeadlines.length} scadenze totali • {completed.length} completate • {upcoming.length} future
            </div>

            {assetDeadlines.length === 0 ? (
              <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>📅</div>
                <div style={{ fontSize:14, fontWeight:600, color:"#8a877f", marginBottom:8 }}>Nessuna scadenza</div>
                <div style={{ fontSize:12, color:"#b5b2a8" }}>Clicca "+ Aggiungi" per creare una scadenza</div>
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
                          {d.date.toLocaleDateString('it-IT')}
                          {d.recurring && d.recurring.enabled && ` • ${d.recurring.index}/${d.recurring.total}`}
                        </div>
                        {d.notes && (
                          <div style={{ fontSize:10, color:"#6b6961", marginTop:4, fontStyle:"italic" }}>{d.notes}</div>
                        )}
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:14, fontWeight:800, color: d.done ? "#4CAF6E" : "#5B8DD9" }}>€{d.budget}</div>
                        {d.done && (
                          <div style={{ fontSize:9, color:"#4CAF6E", fontWeight:600, marginTop:2 }}>✓ Completata</div>
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
                  placeholder="🔍 Cerca nei lavori..."
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
                <span style={{ fontSize:16 }}>+</span> Aggiungi lavoro
              </button>
            </div>

            {assetWorkLogs.length === 0 ? (
              <div style={{ textAlign:"center", padding:"40px 20px", color:"#b5b2a8" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>🔧</div>
                <div style={{ fontSize:14, fontWeight:600, color:"#8a877f", marginBottom:6 }}>Nessun lavoro registrato</div>
                <div style={{ fontSize:12, color:"#b5b2a8" }}>Aggiungi lavori per tenere traccia di manutenzioni e interventi</div>
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
                    <div style={{ fontSize:13, color:"#8a877f" }}>Nessun risultato per "{searchQuery}"</div>
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
                          {log.date.toLocaleDateString('it-IT')}
                        </div>
                      </div>
                      {log.cost > 0 && (
                        <div style={{ fontSize:14, fontWeight:800, color:"#4CAF6E" }}>€{log.cost}</div>
                      )}
                    </div>
                    
                    {isAuto && log.km && (
                      <div style={{ background:"#fff", borderRadius:6, padding:"6px 8px", marginBottom:6, fontSize:11, color:"#6b6961" }}>
                        🚗 {log.km.toLocaleString()} km
                        {log.nextKm && ` → prossimo: ${log.nextKm.toLocaleString()} km`}
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
          🔧 {workLog ? "Modifica" : "Nuovo"} lavoro - {assetName}
        </h3>

        <label style={lbl}>Titolo *</label>
        <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Descrivi il lavoro" style={inp}/>

        <label style={{ ...lbl, marginTop:12 }}>Data *</label>
        <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={inp}/>

        {isAuto && (
          <>
            <label style={{ ...lbl, marginTop:12 }}>🚗 Chilometraggio</label>
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1 }}>
                <input type="number" value={form.km} onChange={e => set("km", e.target.value)} placeholder="Attuale" style={inp}/>
              </div>
              <div style={{ flex:1 }}>
                <input type="number" value={form.nextKm} onChange={e => set("nextKm", e.target.value)} placeholder="Prossimo" style={inp}/>
              </div>
            </div>
          </>
        )}

        <label style={{ ...lbl, marginTop:12 }}>Descrizione lavori</label>
        <textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="Dettagli del lavoro eseguito..." rows={3} style={{ ...inp, resize:"vertical" }}/>

        <label style={{ ...lbl, marginTop:12 }}>Costo (€)</label>
        <input type="number" value={form.cost} onChange={e => set("cost", e.target.value)} placeholder="0" style={inp}/>

        {/* Create Deadline button */}
        <button onClick={() => { onCreateDeadline(form); onClose(); }} style={{
          width:"100%", marginTop:16, padding:"10px", borderRadius:10, border:"2px dashed #5B8DD9", background:"#EBF2FC",
          color:"#5B8DD9", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6
        }}>
          📅 Apri prossima scadenza lavori
        </button>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>Annulla</button>
          <button onClick={handleSave} disabled={!form.title || !form.date} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background: form.title && form.date ? "#2d2b26" : "#e8e6e0", color:"#fff", cursor: form.title && form.date ? "pointer" : "not-allowed", fontSize:14, fontWeight:700 }}>Salva</button>
        </div>
      </div>
    </div>
  );
}
function CategorySheet({ open, onClose, cats, onUpdateCats, deadlines, workLogs }) {
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
    if (window.confirm("Eliminare questa categoria? Le scadenze associate non verranno eliminate.")) {
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
        <h3 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>Gestione categorie</h3>

        {cats.map(cat => (
          <div key={cat.id} style={{ marginBottom:20, background:"#faf9f7", borderRadius:14, padding:"14px 16px", border:"1px solid #edecea" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <div style={{ width:40, height:40, borderRadius:10, background:cat.light, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, border:`2px solid ${cat.color}44` }}>
                {cat.icon}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:700, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>{cat.label}</div>
                <div style={{ fontSize:11, color:"#8a877f" }}>{cat.assets.length > 0 ? `${cat.assets.length} asset collegat${cat.assets.length > 1 ? "i" : "o"}` : "Categoria generica"}</div>
              </div>
              <button onClick={() => setEditingId(editingId === cat.id ? null : cat.id)} style={{
                background: editingId === cat.id ? cat.color : cat.light,
                color: editingId === cat.id ? "#fff" : cat.color,
                border:"none", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:700, cursor:"pointer",
              }}>{editingId === cat.id ? "Chiudi" : "Modifica"}</button>
              {/* Elimina solo se custom (non nelle prime 6 default) */}
              {cats.indexOf(cat) >= 6 && (
                <button onClick={() => deleteCategory(cat.id)} style={{
                  background:"#FFF0EC", color:"#E53935", border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer",
                }}>🗑</button>
              )}
            </div>

            {editingId === cat.id && (
              <div style={{ borderTop:"1px solid #edecea", paddingTop:10 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", textTransform:"uppercase", marginBottom:6 }}>Assets collegati</div>
                {cat.assets.length === 0 ? (
                  <div style={{ fontSize:12, color:"#b5b2a8", fontStyle:"italic", marginBottom:8 }}>Nessun asset. Aggiungi il primo per specificare quale auto, casa, etc.</div>
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
                    placeholder="Nuovo asset (es. Fiat Panda)"
                    onKeyDown={e => e.key === "Enter" && addAsset(cat.id)}
                    style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:13, outline:"none", background:"#fff" }}
                  />
                  <button onClick={() => addAsset(cat.id)} style={{
                    background:cat.color, color:"#fff", border:"none", borderRadius:8, padding:"8px 14px", fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>+ Aggiungi</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Nuova categoria */}
        {showAddCat ? (
          <div style={{ marginBottom:20, background:"#fff", borderRadius:14, padding:"14px 16px", border:"2px solid #5B8DD9" }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#2d2b26", marginBottom:12 }}>Nuova categoria</div>
            
            <label style={{ display:"block", fontSize:10, fontWeight:700, color:"#8a877f", marginBottom:5, textTransform:"uppercase" }}>Nome</label>
            <input
              value={newCat.label}
              onChange={e => setNewCat({...newCat, label: e.target.value})}
              placeholder="Es. Viaggi"
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e8e6e0", fontSize:14, outline:"none", marginBottom:10 }}
            />

            <label style={{ display:"block", fontSize:10, fontWeight:700, color:"#8a877f", marginBottom:5, textTransform:"uppercase" }}>Emoji</label>
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

            <label style={{ display:"block", fontSize:10, fontWeight:700, color:"#8a877f", marginBottom:5, textTransform:"uppercase" }}>Colore</label>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              {["#E8855D","#5B8DD9","#C77DBA","#4CAF6E","#F0B84D","#7B8BE8","#E53935","#9C27B0"].map(c => (
                <button key={c} onClick={() => setNewCat({...newCat, color: c})} style={{
                  width:36, height:36, borderRadius:"50%", background:c, border: newCat.color === c ? "3px solid #2d2b26" : "2px solid #e8e6e0", cursor:"pointer",
                }}/>
              ))}
            </div>

            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowAddCat(false)} style={{ flex:1, padding:"10px", borderRadius:8, border:"1px solid #e8e6e0", background:"#fff", color:"#6b6961", fontSize:13, fontWeight:600, cursor:"pointer" }}>Annulla</button>
              <button onClick={addCategory} style={{ flex:1, padding:"10px", borderRadius:8, border:"none", background:"#5B8DD9", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Crea categoria</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddCat(true)} style={{
            width:"100%", padding:"14px", borderRadius:14, border:"2px dashed #e8e6e0", background:"transparent", color:"#8a877f", cursor:"pointer", fontSize:14, fontWeight:700, marginBottom:12,
          }}>+ Aggiungi categoria</button>
        )}

        <button onClick={onClose} style={{ width:"100%", padding:"14px", borderRadius:14, border:"none", background:"#2d2b26", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, minHeight:48 }}>Chiudi</button>
        
        {/* Export/Import Data */}
        <div style={{ marginTop:20, paddingTop:20, borderTop:"2px solid #f5f4f0" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#8a877f", marginBottom:10, textTransform:"uppercase" }}>📤 Backup & Condivisione</div>
          
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
            alert('✅ Dati esportati! Trovi il file in Downloads');
          }} style={{ 
            width:"100%", padding:"12px", borderRadius:14, border:"2px solid #5B8DD9", background:"#EBF2FC", color:"#5B8DD9", cursor:"pointer", fontSize:13, fontWeight:700, marginBottom:10, display:"flex", alignItems:"center", justifyContent:"center", gap:6
          }}>
            📥 Esporta Dati (JSON)
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
                    alert('❌ File non valido');
                    return;
                  }
                  
                  // Confirm import
                  if (!window.confirm(`Importare ${data.deadlines.length} scadenze e ${data.categories.length} categorie?\n\n⚠️ Questo sostituirà i dati attuali!`)) {
                    return;
                  }
                  
                  // Import data
                  localStorage.setItem('lifetrack_categories', JSON.stringify(data.categories));
                  localStorage.setItem('lifetrack_deadlines', JSON.stringify(data.deadlines));
                  localStorage.setItem('lifetrack_worklogs', JSON.stringify(data.workLogs || {}));
                  
                  alert('✅ Dati importati! La pagina si ricaricherà.');
                  window.location.reload();
                } catch (err) {
                  alert('❌ Errore lettura file: ' + err.message);
                }
              };
              reader.readAsText(file);
              e.target.value = ''; // Reset input
            }} />
            📤 Importa Dati (JSON)
          </label>
          
          <div style={{ fontSize:10, color:"#8a877f", marginTop:8, lineHeight:1.4 }}>
            💡 <strong>Per condividere:</strong> Esporta → invia file via WhatsApp → destinatario fa Importa
          </div>
        </div>
        
        {/* Reset button for testing */}
        <button onClick={() => {
          if (window.confirm("Resettare tutti i dati? Questa azione non può essere annullata.")) {
            localStorage.removeItem('lifetrack_categories');
            localStorage.removeItem('lifetrack_deadlines');
            window.location.reload();
          }
        }} style={{ 
          width:"100%", padding:"12px", borderRadius:14, border:"1px solid #FBE9E7", background:"#FFF0EC", color:"#E53935", cursor:"pointer", fontSize:12, fontWeight:600, marginTop:10 
        }}>🗑 Reset dati (per test)</button>
      </div>
    </div>
  );
}

/* ── APP ROOT ──────────────────────────────────────────── */
export default function App() {
  // 🔥 Firebase State
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const suppressSaveRef = useRef(false);
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
      const parsed = JSON.parse(saved);
      // Convert date values back to Date objects (supports Firestore Timestamps)
      Object.keys(parsed).forEach(key => {
        parsed[key] = parsed[key]
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
    return {}; // { "casa_colico": [...], "auto_micro": [...] }
  });

  // 🔥 Firebase Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || null);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 🔥 Firebase Sync (polling to avoid WebChannel issues)
  useEffect(() => {
    if (!user) return;
    const docRef = doc(db, 'users', user.uid);

    const applySnapshot = (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      const parsedDeadlines = (data.deadlines || [])
        .map(d => {
          const date = toDate(d.date);
          if (!isValidDate(date)) return null;
          return { ...d, date };
        })
        .filter(Boolean);
      const parsedWorkLogs = {};
      Object.keys(data.workLogs || {}).forEach(key => {
        parsedWorkLogs[key] = (data.workLogs[key] || [])
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
      suppressSaveRef.current = true;
      setDeadlines(parsedDeadlines);
      setCats(data.categories || DEFAULT_CATS);
      setWorkLogs(parsedWorkLogs);
    };

    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const snap = await getDoc(docRef);
        if (!cancelled) applySnapshot(snap);
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

  // 🔥 Firebase Auto-Save
  useEffect(() => {
    if (!user || loading) return;
    if (suppressSaveRef.current) {
      suppressSaveRef.current = false;
      return;
    }
    
    const saveTimer = setTimeout(async () => {
      try {
        setSyncing(true);
        await setDoc(doc(db, 'users', user.uid), {
          deadlines,
          categories: cats,
          workLogs,
          lastUpdate: new Date().toISOString()
        });
        setSyncing(false);
      } catch (error) {
        console.error("Firebase save error:", error);
        setSyncing(false);
      }
    }, 1000);
    
    return () => clearTimeout(saveTimer);
  }, [deadlines, cats, workLogs, user, loading]);

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
          showToast(`✓ ${count} pagament${count > 1 ? 'i automatici completati' : 'o automatico completato'}`);
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
    list.sort((a, b) => a.date - b.date);
    return list;
  }, [deadlines, range, filterCat, filterAsset, filterMandatory, filterRecurring, filterAutoPay, filterEssential, activeTab, maxDays]);

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
    showToast("✓ Scadenza saltata");
  };
  
  const confirmPayment = (type) => {
    const item = deadlines.find(d => d.id === paymentFlow.itemId);
    if (!item) return;
    
    switch(type) {
      case 'full': // Pagata per intero al budget previsto
        setDeadlines(p => p.map(d => d.id === item.id ? { ...d, done: true, estimateMissing: false } : d));
        showToast(`✓ Pagata €${item.budget}`);
        break;
        
      case 'not_paid': // Non pagata - azzera budget
        setDeadlines(p => p.map(d => d.id === item.id ? { ...d, done: true, budget: 0, estimateMissing: false } : d));
        showToast("✓ Segnata come non pagata");
        break;
        
      case 'partial': // Importo diverso - aggiorna budget con importo reale
        const amount = Number(paymentAmount) || 0;
        setDeadlines(p => p.map(d => d.id === item.id ? { ...d, done: true, budget: amount, estimateMissing: false } : d));
        showToast(`✓ Pagata €${amount}`);
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
        showToast(`✓ Acconto €${downAmount} - Saldo €${remaining} creato`);
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
        showToast("✓ Scadenza eliminata");
      }
    } else {
      // Non fa parte di una serie, elimina direttamente
      setDeadlines(p => p.filter(d => d.id !== id));
      setExpandedId(null);
      showToast("✓ Scadenza eliminata");
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
    showToast(`✓ Eliminate ${deleteConfirm.futureCount} scadenze future`);
    setDeleteConfirm(null);
  };
  const add = items => { 
    const itemsArray = Array.isArray(items) ? items : [items];
    setDeadlines(p => [...p, ...itemsArray]); 
    
    // Check if any deadline is outside current range
    const outsideRange = itemsArray.filter(item => diffDays(item.date) > maxDays);
    if (outsideRange.length > 0) {
      const rangeLabel = RANGES.find(r => r.id === range)?.label || range;
      if (itemsArray.length > 1) {
        showToast(`✓ Serie creata! ${outsideRange.length}/${itemsArray.length} oltre ${rangeLabel}`);
      } else {
        showToast(`✓ Scadenza aggiunta! È oltre ${rangeLabel} - cambia range per vederla`);
      }
    } else if (itemsArray.length > 1) {
      showToast(`✓ ${itemsArray.length} scadenze create`);
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
      showToast("✓ Scadenza posticipata");
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
      showToast(`✓ Documento allegato`);
    } catch(err) {
      showToast("✗ Errore upload documento");
    }
  };
  
  const deleteDocument = (deadlineId, docId) => {
    setDeadlines(p => p.map(d => d.id === deadlineId ? { ...d, documents: d.documents.filter(doc => doc.id !== docId) } : d));
    showToast("✓ Documento eliminato");
  };

  const handleAuth = async () => {
    if (!authEmail || !authPassword) {
      setAuthError("Inserisci email e password");
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
      let msg = "Errore autenticazione";
      if (code.includes("auth/invalid-email")) msg = "Email non valida";
      else if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) msg = "Credenziali errate";
      else if (code.includes("auth/user-not-found")) msg = "Utente non trovato";
      else if (code.includes("auth/email-already-in-use")) msg = "Email già registrata";
      else if (code.includes("auth/weak-password")) msg = "Password troppo corta (min 6)";
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
    if (!navigator.share) {
      showToast("Condivisione non supportata su questo dispositivo");
      return;
    }
    try {
      const response = await fetch(doc.base64);
      const blob = await response.blob();
      const file = new File([blob], doc.filename || "documento.jpg", { type: blob.type || "image/jpeg" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        await navigator.share({ title: doc.filename || "Documento", url: doc.base64 });
        return;
      }
      await navigator.share({ files: [file], title: doc.filename || "Documento" });
    } catch (error) {
      console.error("Share error:", error);
      showToast("Errore condivisione");
    }
  };

  // 🔥 Loading Screen (after all hooks)
  if (loading) {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#1e1c18", color:"#fff" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📅</div>
          <div style={{ fontSize:20, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>LifeTrack</div>
          <div style={{ fontSize:13, opacity:.5, marginTop:8 }}>Caricamento...</div>
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
        <div style={{ width:"100%", maxWidth:360, background:"#2d2b26", borderRadius:18, padding:"22px 20px", boxShadow:"0 10px 30px rgba(0,0,0,.35)" }}>
          <div style={{ textAlign:"center", marginBottom:16 }}>
            <div style={{ fontSize:40, marginBottom:6 }}>📅</div>
            <div style={{ fontSize:18, fontWeight:800, fontFamily:"'Sora',sans-serif" }}>LifeTrack</div>
            <div style={{ fontSize:12, opacity:.6, marginTop:4 }}>Accedi per sincronizzare su tutti i dispositivi</div>
          </div>

          <label style={{ display:"block", fontSize:10, fontWeight:700, color:"rgba(255,255,255,.55)", marginBottom:6, letterSpacing:".6px", textTransform:"uppercase" }}>Email</label>
          <input
            type="email"
            value={authEmail}
            onChange={e => setAuthEmail(e.target.value)}
            placeholder="nome@email.com"
            style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #3a3731", background:"#1f1d19", color:"#fff", marginBottom:12, fontSize:14, outline:"none" }}
          />

          <label style={{ display:"block", fontSize:10, fontWeight:700, color:"rgba(255,255,255,.55)", marginBottom:6, letterSpacing:".6px", textTransform:"uppercase" }}>Password</label>
          <input
            type="password"
            value={authPassword}
            onChange={e => setAuthPassword(e.target.value)}
            placeholder="••••••"
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
            {authMode === "signup" ? "Crea account" : "Accedi"}
          </button>

          <div style={{ marginTop:12, textAlign:"center", fontSize:12, color:"rgba(255,255,255,.6)" }}>
            {authMode === "signup" ? "Hai già un account?" : "Non hai un account?"}{" "}
            <button
              onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setAuthError(""); }}
              style={{ background:"transparent", border:"none", color:"#E8855D", fontWeight:700, cursor:"pointer" }}
            >
              {authMode === "signup" ? "Accedi" : "Crea account"}
            </button>
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
          Salvataggio...
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
                <h1 style={{ margin:0, fontSize:18, fontWeight:800, letterSpacing:"-.6px" }}>LifeTrack</h1>
                <span style={{ fontSize:10, opacity:.35 }}>gestione scadenze</span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
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
          { id:"timeline", label:"Timeline" }, 
          { id:"overdue", label:"Scadute" },
          { id:"done", label:"Completate" }
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            flex:1, padding:"12px 0", border:"none", background:"transparent", cursor:"pointer",
            fontSize:14, fontWeight: activeTab === t.id ? 700 : 500,
            color: activeTab === t.id ? (t.id === "overdue" ? "#E53935" : "#2d2b26") : "#8a877f",
            borderBottom: activeTab === t.id ? `2.5px solid ${t.id === "overdue" ? "#E53935" : "#2d2b26"}` : "2.5px solid transparent",
            transition:"all .2s", minHeight:44,
          }}>{t.label}</button>
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
      />

      {/* LISTA */}
      <div style={{ flex:1, overflowY:"auto", padding:"0 18px", paddingBottom:90 }}>
        {groups.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px", color:"#b5b2a8" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>{activeTab === "done" ? "🎉" : "📅"}</div>
            <div style={{ fontSize:15, fontWeight:600, color:"#8a877f" }}>{activeTab === "done" ? "Nessuna scadenza completata" : "Nessuna scadenza in questo periodo"}</div>
            <div style={{ fontSize:13, marginTop:4 }}>Prova a cambiare l'intervallo temporale</div>
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
              showToast("✓ Lavoro aggiornato");
            } else {
              // Add new
              setWorkLogs(prev => ({
                ...prev,
                [assetKey]: [...(prev[assetKey] || []), work]
              }));
              showToast("✓ Lavoro aggiunto al registro");
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
            <h3 style={{ margin:"0 0 14px", fontSize:17, fontWeight:800, color:"#2d2b26", fontFamily:"'Sora',sans-serif" }}>Posticipa scadenza</h3>
            <p style={{ margin:"0 0 16px", fontSize:13, color:"#6b6961" }}>Scegli la nuova data per questa scadenza</p>
            <input
              type="date"
              value={postponeDate}
              onChange={e => setPostponeDate(e.target.value)}
              style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"2px solid #edecea", fontSize:14, outline:"none", marginBottom:16 }}
              autoFocus
            />
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setPostponeId(null)} style={{ flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961" }}>Annulla</button>
              <button onClick={confirmPostpone} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#FB8C00", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 }}>Conferma</button>
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
              Modifica ricorrenza
            </h3>
            <p style={{ margin:"0 0 10px", fontSize:13, color:"#6b6961" }}>
              Vuoi applicare le modifiche solo a questa scadenza o anche alle altre?
            </p>
            {editScheduleChanged && (
              <p style={{ margin:"0 0 14px", fontSize:12, color:"#E53935", fontWeight:600 }}>
                Attenzione: cambiando frequenza o data, “Tutta la serie” rigenera tutte le occorrenze.
              </p>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <button onClick={() => applyEditScope("single")} style={{ padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, color:"#2d2b26" }}>
                Solo questa
              </button>
              <button onClick={() => applyEditScope("future")} style={{ padding:"12px", borderRadius:12, border:"none", background:"#2d2b26", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 }}>
                Da questa in poi
              </button>
              <button onClick={() => applyEditScope("all")} style={{ padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, color:"#6b6961" }}>
                Tutta la serie
              </button>
            </div>
            <button onClick={() => setEditConfirm(null)} style={{ marginTop:12, width:"100%", padding:"10px", borderRadius:10, border:"none", background:"#edecea", color:"#6b6961", fontSize:13, fontWeight:600, cursor:"pointer" }}>
              Annulla
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
              Elimina serie ricorrente
            </h3>
            <p style={{ margin:"0 0 8px", fontSize:14, color:"#2d2b26", lineHeight:1.5 }}>
              Questa scadenza fa parte di una serie ({deleteConfirm.recurringIndex}/{deleteConfirm.recurringTotal}).
            </p>
            <p style={{ margin:"0 0 16px", fontSize:14, color:"#2d2b26", fontWeight:600, lineHeight:1.5 }}>
              Verranno eliminate questa e le {deleteConfirm.futureCount - 1} scadenze future della serie.
            </p>
            <p style={{ margin:"0 0 20px", fontSize:12, color:"#8a877f", fontStyle:"italic" }}>
              (Le scadenze passate già completate non verranno toccate)
            </p>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ 
                flex:1, padding:"12px", borderRadius:12, border:"2px solid #e8e6e0", background:"#fff", 
                cursor:"pointer", fontSize:14, fontWeight:600, color:"#6b6961", minHeight:44 
              }}>Annulla</button>
              <button onClick={confirmDelete} style={{ 
                flex:1, padding:"12px", borderRadius:12, border:"none", background:"#E53935", 
                color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700, minHeight:44 
              }}>Elimina serie</button>
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
              Apri
            </a>
            <a
              href={viewingDoc.base64}
              download={viewingDoc.filename || "documento"}
              style={{ padding:"12px 18px", borderRadius:12, border:"2px solid #fff", background:"transparent", color:"#fff", fontSize:13, fontWeight:700, textDecoration:"none", cursor:"pointer" }}
              onClick={e => e.stopPropagation()}
            >
              Scarica
            </a>
            <button
              onClick={(e) => { e.stopPropagation(); shareDocument(viewingDoc); }}
              style={{ padding:"12px 18px", borderRadius:12, border:"none", background:"#5B8DD9", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}
            >
              Condividi
            </button>
            <button onClick={() => setViewingDoc(null)} style={{ padding:"12px 18px", borderRadius:12, border:"none", background:"#fff", color:"#2d2b26", fontSize:13, fontWeight:700, cursor:"pointer" }}>Chiudi</button>
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
