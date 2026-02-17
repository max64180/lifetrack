import { useEffect, useState } from "react";
import { getCat } from "../utils/cats";

const PAGE_BG = "#E6DBCF";
const CARD_BG = "#F7F0EA";
const PANEL_BG = "#FFFDFB";
const TEXT_PRIMARY = "#3F342C";
const TEXT_SECONDARY = "#6F6258";
const TEXT_MUTED = "#9A8F86";
const BORDER = "#DDD3CA";
const BORDER_SOFT = "#E7DED6";
const BRAND = "#C6A14A";
const DANGER_BG = "#F4E8E6";
const DANGER_TEXT = "#B3473A";

const TITLE_FONT = "'Playfair Display', 'Cormorant Garamond', Georgia, serif";
const BODY_FONT = "'Inter', system-ui, -apple-system, sans-serif";
const DAY_MS = 86400000;

function formatMoney(item, formatNumber, t) {
  if (!item) return "";
  if (item.estimateMissing) return t("card.estimateMissing", { defaultValue: "Da stimare" });
  if (item.skipped) return "€0";
  return `€${formatNumber(item.budget || 0)}`;
}

function formatLongDate(value, locale) {
  const d = value instanceof Date ? value : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function startOfDay(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDayDiff(value) {
  return Math.round((startOfDay(value) - startOfDay(new Date())) / DAY_MS);
}

function getDueBadge(item, t) {
  if (!item) return null;
  if (item.skipped) {
    return {
      label: t("card.skipped", { defaultValue: "Non dovuta" }),
      hint: t("detail.noUrgentAction", { defaultValue: "Tutto a posto per questa scadenza" }),
      bg: "#f0efe8",
      color: "#6b6961",
    };
  }
  if (item.done) {
    return {
      label: t("tabs.done", { defaultValue: "Completata" }),
      hint: t("detail.noUrgentAction", { defaultValue: "Nessuna azione urgente adesso" }),
      bg: "#E8F5E9",
      color: "#2E7D32",
    };
  }

  const days = getDayDiff(item.date);
  if (days < 0) {
    return {
      label: t("detail.overdue", { defaultValue: "Scaduta" }),
      hint: t("detail.overdueDays", { defaultValue: "Scaduta da {{days}} giorni", days: Math.abs(days) }),
      bg: "#FFF0EC",
      color: "#B3473A",
    };
  }
  if (days === 0) {
    return {
      label: t("detail.today", { defaultValue: "Scade oggi" }),
      hint: t("detail.todayHint", { defaultValue: "Da gestire oggi" }),
      bg: "#EBF2FC",
      color: "#4A6E99",
    };
  }
  return {
    label: t("detail.upcoming", { defaultValue: "In arrivo" }),
    hint: t("detail.inDays", { defaultValue: "Da pianificare entro {{days}} giorni", days }),
    bg: "#FFF6E8",
    color: "#9A7830",
  };
}

function recurringSummary(item, t) {
  if (!item?.recurring?.enabled) return t("card.never", { defaultValue: "Mai" });
  const unitMap = { giorni: "day", settimane: "week", mesi: "month", anni: "year", days: "day", weeks: "week", months: "month", years: "year" };
  const unitKey = unitMap[item.recurring.unit] || "month";
  const unitLabel = item.recurring.interval === 1 ? t(`units.${unitKey}.one`) : t(`units.${unitKey}.other`);
  return t("card.repeatPattern", {
    defaultValue: "Ogni {{interval}} {{unit}}",
    interval: item.recurring.interval,
    unit: unitLabel,
    index: item.recurring.index,
    total: item.recurring.total,
  });
}

function statusRows(item, t) {
  if (!item) return [];
  const out = [];
  if (item.skipped) out.push({ key: "skipped", label: t("card.skipped", { defaultValue: "Non dovuta" }), bg: "#f0efe8", color: "#6b6961" });
  if (item.done && !item.skipped) out.push({ key: "done", label: t("tabs.done", { defaultValue: "Completata" }), bg: "#E8F5E9", color: "#2E7D32" });
  if (item.mandatory) out.push({ key: "mandatory", label: t("card.mandatory", { defaultValue: "Inderogabile" }), bg: "#FFF0EC", color: "#B3473A" });
  if (item.autoPay && !item.done) out.push({ key: "autopay", label: t("card.autoPayActive", { defaultValue: "Automatica attiva" }), bg: "#EBF2FC", color: "#4A6E99" });
  if (item.autoCompleted && item.done) out.push({ key: "autodone", label: t("card.autoCompleted", { defaultValue: "Completata automaticamente" }), bg: "#E8F5E9", color: "#2E7D32" });
  if (item.recurring?.enabled) out.push({ key: "recurring", label: t("card.repeats", { defaultValue: "Ricorrente" }), bg: "#EEF3F5", color: "#4C6470" });
  return out;
}

export default function DeadlineDetailPage({
  open,
  item,
  t,
  locale,
  cats,
  formatNumber,
  source,
  onClose,
  onViewDoc,
  onEdit,
  onComplete,
  onPostpone,
  onSkip,
  onDelete,
  onUploadDoc,
  onDeleteDoc,
}) {
  const [showMoreActions, setShowMoreActions] = useState(false);

  useEffect(() => {
    if (!open) setShowMoreActions(false);
  }, [open]);

  if (!open || !item) return null;

  const cat = item.petId
    ? { id: "pet", label: "Pet", color: "#7B8BE8", light: "#EEF0FF" }
    : getCat(cats || [], item.cat);
  const isPet = !!item.petId;
  const catLabel = t(cat.labelKey || "", { defaultValue: cat.label || "-" });
  const statuses = statusRows(item, t);
  const docs = Array.isArray(item.documents) ? item.documents : [];
  const dueBadge = getDueBadge(item, t);
  const recurrenceLabel = recurringSummary(item, t);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 250,
        background: PAGE_BG,
        overflowY: "auto",
        paddingBottom: 20,
      }}
    >
      <div style={{ maxWidth: 430, margin: "0 auto", minHeight: "100vh", fontFamily: BODY_FONT }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: PAGE_BG, padding: "10px 16px 8px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            aria-label={t("actions.close", { defaultValue: "Chiudi" })}
            style={{
              width: 36,
              height: 36,
              border: `1px solid ${BORDER}`,
              background: CARD_BG,
              color: TEXT_SECONDARY,
              borderRadius: "50%",
              fontSize: 22,
              fontWeight: 500,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "4px 16px 138px" }}>
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 20,
              background: CARD_BG,
              boxShadow: "0 8px 24px rgba(90, 70, 50, 0.11)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "14px 14px 12px" }}>
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>
                    {source === "home"
                    ? t("detail.fromHome", { defaultValue: "Vista rapida da Home" })
                    : t("detail.fromDeadlines", { defaultValue: "Vista completa da Scadenze" })}
                </span>
              </div>
              <div style={{ fontFamily: TITLE_FONT, color: TEXT_PRIMARY, fontSize: 28, lineHeight: "32px", fontWeight: 500 }}>
                {item.title}
              </div>
              <div style={{ marginTop: 4, color: TEXT_SECONDARY, fontSize: 14 }}>
                {formatLongDate(item.date, locale)}
              </div>
              <div style={{ marginTop: 8, color: TEXT_PRIMARY, fontFamily: TITLE_FONT, fontSize: 30, lineHeight: "34px", fontWeight: 500 }}>
                {formatMoney(item, formatNumber, t)}
              </div>
              {dueBadge && (
                <div style={{ marginTop: 10, border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: PANEL_BG, padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: dueBadge.color, background: dueBadge.bg, borderRadius: 999, padding: "4px 8px" }}>
                      {dueBadge.label}
                    </span>
                    <span style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>
                      {t("detail.priority", { defaultValue: "Cosa fare ora" })}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, color: TEXT_SECONDARY, fontSize: 13, lineHeight: "18px" }}>{dueBadge.hint}</div>
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${BORDER_SOFT}`, padding: "10px 12px", display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: PANEL_BG, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>
                    {t("card.category", { defaultValue: "Area" })}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 14, color: TEXT_PRIMARY, fontWeight: 600 }}>{catLabel}</div>
                </div>
                <div style={{ border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: PANEL_BG, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>
                    {t("asset.title", { defaultValue: "Asset" })}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 14, color: TEXT_PRIMARY, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.asset || "-"}
                  </div>
                </div>
              </div>
              <div style={{ border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: PANEL_BG, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px", marginBottom: 4 }}>
                  {t("card.repeats", { defaultValue: "Ricorrenza" })}
                </div>
                <div style={{ fontSize: 13, color: TEXT_SECONDARY }}>{recurrenceLabel}</div>
              </div>

              {statuses.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {statuses.map((status) => (
                    <span
                      key={status.key}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: status.color,
                        background: status.bg,
                        borderRadius: 999,
                        padding: "5px 8px",
                      }}
                    >
                      {status.label}
                    </span>
                  ))}
                </div>
              )}

              {item.notes && (
                <div style={{ border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: PANEL_BG, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px", marginBottom: 4 }}>
                    {t("card.notes", { defaultValue: "Note" })}
                  </div>
                  <div style={{ fontSize: 14, color: TEXT_SECONDARY, lineHeight: "19px" }}>{item.notes}</div>
                </div>
              )}

              <div style={{ border: `1px solid ${BORDER_SOFT}`, borderRadius: 12, background: PANEL_BG, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px", marginBottom: 6 }}>
                  {t("docs.title", { defaultValue: "Documenti" })}
                </div>
                {docs.length === 0 ? (
                  <div style={{ fontSize: 13, color: TEXT_MUTED }}>{t("docs.none", { defaultValue: "Nessun documento" })}</div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {docs.map((doc) => (
                      <div key={doc.id || doc.filename} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${BORDER_SOFT}`, borderRadius: 10, padding: "7px 8px", background: "#fff" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: TEXT_PRIMARY, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {doc.filename || t("docs.document", { defaultValue: "Documento" })}
                          </div>
                          <div style={{ fontSize: 10, color: TEXT_MUTED }}>{doc.type === "receipt" ? t("docs.receipt") : t("docs.document")}</div>
                        </div>
                        <button
                          onClick={() => onViewDoc && onViewDoc(doc)}
                          style={{ border: `1px solid ${BORDER}`, background: CARD_BG, color: TEXT_PRIMARY, borderRadius: 8, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                        >
                          {t("actions.view", { defaultValue: "Apri" })}
                        </button>
                        {!isPet && onDeleteDoc && (
                          <button
                            onClick={() => {
                              if (!window.confirm(t("docs.deleteConfirm"))) return;
                              onDeleteDoc(item.id, doc.id);
                            }}
                            style={{ border: "none", background: "#FFF0EC", color: "#B3473A", borderRadius: 8, padding: "4px 7px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!isPet && onUploadDoc && (
                  <label
                    style={{
                      marginTop: 8,
                      display: "block",
                      border: `1px dashed ${BORDER}`,
                      background: "#fff",
                      color: TEXT_SECONDARY,
                      borderRadius: 10,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: "center",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="file"
                      accept="image/*,application/pdf,*/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files && e.target.files[0];
                        if (file) onUploadDoc(item.id, item.done ? "receipt" : "incoming", file);
                        e.target.value = "";
                      }}
                    />
                    {item.done
                      ? t("docs.attachReceipt", { defaultValue: "Aggiungi ricevuta" })
                      : t("docs.attachDocument", { defaultValue: "Aggiungi documento" })}
                  </label>
                )}
              </div>

            </div>
          </div>
        </div>

        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 260,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 430,
              padding: "10px 16px 12px",
              background: PAGE_BG,
              borderTop: `1px solid ${BORDER_SOFT}`,
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: 10,
              boxShadow: "0 -8px 20px rgba(90, 70, 50, 0.10)",
              pointerEvents: "auto",
            }}
          >
            <button
              onClick={() => onEdit && onEdit(item)}
              style={{
                border: `1px solid ${BORDER}`,
                background: "#E9E1DA",
                color: TEXT_SECONDARY,
                borderRadius: 14,
                minHeight: 44,
                padding: "10px 12px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t("actions.edit", { defaultValue: "Modifica" })}
            </button>
            <button
              onClick={() => onComplete && onComplete(item.id)}
              style={{
                border: "none",
                background: BRAND,
                color: TEXT_PRIMARY,
                borderRadius: 14,
                minHeight: 44,
                padding: "10px 12px",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {item.done
                ? t("actions.reactivate", { defaultValue: "Riattiva" })
                : t("actions.complete", { defaultValue: "Completa" })}
            </button>
            <button
              onClick={() => setShowMoreActions(true)}
              style={{
                border: `1px solid ${BORDER}`,
                background: "#F4EFE9",
                color: TEXT_SECONDARY,
                borderRadius: 14,
                minHeight: 44,
                padding: "10px 12px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                minWidth: 82,
              }}
            >
              {t("actions.more", { defaultValue: "Altro" })}
            </button>
          </div>
        </div>

        {showMoreActions && (
          <div
            onClick={() => setShowMoreActions(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(24,20,16,0.42)",
              zIndex: 300,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              padding: "12px 16px",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 430,
                borderRadius: 18,
                border: `1px solid ${BORDER}`,
                background: CARD_BG,
                boxShadow: "0 14px 30px rgba(0,0,0,.18)",
                padding: 10,
                display: "grid",
                gap: 8,
              }}
            >
              {!item.done && (
                <button
                  onClick={() => {
                    setShowMoreActions(false);
                    onPostpone && onPostpone(item.id);
                  }}
                  style={{
                    border: `1px solid ${BORDER}`,
                    background: "#E9E1DA",
                    color: TEXT_SECONDARY,
                    borderRadius: 12,
                    padding: "11px 12px",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {t("actions.postpone", { defaultValue: "Posticipa" })}
                </button>
              )}
              {item.recurring?.enabled && !item.done && (
                <button
                  onClick={() => {
                    setShowMoreActions(false);
                    onSkip && onSkip(item.id);
                  }}
                  style={{
                    border: `1px solid ${BORDER}`,
                    background: "#E9E1DA",
                    color: TEXT_SECONDARY,
                    borderRadius: 12,
                    padding: "11px 12px",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {t("actions.skip", { defaultValue: "Salta" })}
                </button>
              )}
              <button
                onClick={() => {
                  setShowMoreActions(false);
                  onDelete && onDelete(item.id);
                }}
                style={{
                  border: "none",
                  background: DANGER_BG,
                  color: DANGER_TEXT,
                  borderRadius: 12,
                  padding: "11px 12px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t("actions.delete", { defaultValue: "Elimina" })}
              </button>
              <button
                onClick={() => setShowMoreActions(false)}
                style={{
                  border: `1px solid ${BORDER}`,
                  background: "#fff",
                  color: TEXT_SECONDARY,
                  borderRadius: 12,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("actions.close", { defaultValue: "Chiudi" })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
