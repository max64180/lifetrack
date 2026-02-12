function toDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`);
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date(NaN);
}

function toDateInputValue(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function hasRecurringData(item) {
  if (!item?.recurring || typeof item.recurring !== "object" || Array.isArray(item.recurring)) return false;
  if (item.recurring.enabled === true) return true;
  return [
    item.recurring.seriesId,
    item.recurring.interval,
    item.recurring.unit,
    item.recurring.index,
    item.recurring.total,
  ].some(v => v !== undefined && v !== null && v !== "");
}

export function sameSeriesId(left, right) {
  if (left === undefined || left === null || left === "") return false;
  if (right === undefined || right === null || right === "") return false;
  return String(left) === String(right);
}

export function recurringFingerprint(item) {
  if (!hasRecurringData(item)) return "";
  const interval = Math.max(1, Number(item.recurring?.interval) || 1);
  const unit = item.recurring?.unit || "mesi";
  return [item.title || "", item.cat || "", item.asset || "", interval, unit].join("||");
}

export function collectRecurringSeriesMembers(list, item) {
  if (!Array.isArray(list) || !hasRecurringData(item)) return [];
  const fp = recurringFingerprint(item);
  const rawSeriesId = item.recurring?.seriesId;

  let primary = [];
  if (rawSeriesId !== undefined && rawSeriesId !== null && rawSeriesId !== "") {
    primary = list.filter(d => hasRecurringData(d) && sameSeriesId(d.recurring?.seriesId, rawSeriesId));
  }
  if (primary.length === 0) {
    primary = list.filter(d => hasRecurringData(d) && recurringFingerprint(d) === fp);
  }
  if (primary.length === 0) return [];

  const merged = new Map(primary.map(d => [String(d.id), d]));
  const primaryDates = new Set(primary.map(d => toDateInputValue(d.date)));

  list.forEach(d => {
    if (!hasRecurringData(d)) return;
    if (merged.has(String(d.id))) return;
    if (recurringFingerprint(d) !== fp) return;
    const k = toDateInputValue(d.date);
    if (primaryDates.has(k)) merged.set(String(d.id), d);
  });

  return Array.from(merged.values()).sort((a, b) => {
    const da = toDate(a.date).getTime() || 0;
    const db = toDate(b.date).getTime() || 0;
    if (da !== db) return da - db;
    return (a?.recurring?.index || 0) - (b?.recurring?.index || 0);
  });
}

export function buildRecurringTargetIdSet(list, item, seedMembers = []) {
  const ids = new Set((seedMembers || []).map(d => String(d.id)));
  if (item?.id !== undefined && item?.id !== null) ids.add(String(item.id));
  if (!Array.isArray(list) || !hasRecurringData(item)) return ids;

  const rawSeriesId = item.recurring?.seriesId;
  if (rawSeriesId !== undefined && rawSeriesId !== null && rawSeriesId !== "") {
    list.forEach(d => {
      if (!hasRecurringData(d)) return;
      if (sameSeriesId(d.recurring?.seriesId, rawSeriesId)) ids.add(String(d.id));
    });
  }

  collectRecurringSeriesMembers(list, item).forEach(d => ids.add(String(d.id)));
  return ids;
}

export function dedupeRecurringClonesForItem(list, item) {
  if (!Array.isArray(list)) return list;
  const fp = recurringFingerprint(item);
  if (!fp) return list;
  const bestByDate = new Map();

  list.forEach((d, index) => {
    if (!(hasRecurringData(d) && recurringFingerprint(d) === fp)) return;
    const dateKey = toDateInputValue(d.date);
    if (!dateKey) return;
    const score = sameSeriesId(d.recurring?.seriesId, item.recurring?.seriesId) ? 2 : 0;
    const prev = bestByDate.get(dateKey);
    if (!prev || score > prev.score || (score === prev.score && index > prev.index)) {
      bestByDate.set(dateKey, { id: String(d.id), score, index });
    }
  });

  return list.filter(d => {
    if (!(hasRecurringData(d) && recurringFingerprint(d) === fp)) return true;
    const dateKey = toDateInputValue(d.date);
    if (!dateKey) return true;
    const keep = bestByDate.get(dateKey);
    return keep && keep.id === String(d.id);
  });
}

