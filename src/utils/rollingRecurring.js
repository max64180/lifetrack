import { getAutoEndDate, getOccurrenceDate } from "./recurrence";

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function extendAutoRecurringSeries(deadlines, { horizon = getAutoEndDate(), guardLimit = 800 } = {}) {
  if (!Array.isArray(deadlines) || deadlines.length === 0) {
    return { deadlines: Array.isArray(deadlines) ? deadlines : [], addedCount: 0, updated: false };
  }
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

  if (seriesMap.size === 0) {
    return { deadlines, addedCount: 0, updated: false };
  }

  let updated = false;
  let nextDeadlines = deadlines;
  const newItems = [];

  seriesMap.forEach((items, seriesId) => {
    const ordered = items
      .slice()
      .sort((a, b) => (a.recurring?.index || 0) - (b.recurring?.index || 0));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (!last || !isValidDate(last.date)) return;
    if (!first || !isValidDate(first.date)) return;
    if (last.date >= horizon) return;

    const interval = last.recurring?.interval || 1;
    const unit = last.recurring?.unit || "mesi";
    const lastIndex = Math.max(...ordered.map(d => d.recurring?.index || 0));
    const template = last;
    const anchorDate = first.date;
    const additions = [];
    let guard = 0;
    let nextDate = getOccurrenceDate(anchorDate, lastIndex, interval, unit);

    while (nextDate <= horizon && guard < guardLimit) {
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
        },
      });
      nextDate = getOccurrenceDate(anchorDate, newIndex, interval, unit);
    }

    if (additions.length === 0) return;

    const newTotal = lastIndex + additions.length;
    updated = true;
    nextDeadlines = nextDeadlines.map(d => (
      d.recurring?.seriesId === seriesId
        ? { ...d, recurring: { ...d.recurring, total: newTotal } }
        : d
    ));
    newItems.push(...additions.map(d => ({ ...d, recurring: { ...d.recurring, total: newTotal } })));
  });

  if (!updated) return { deadlines, addedCount: 0, updated: false };
  return { deadlines: [...nextDeadlines, ...newItems], addedCount: newItems.length, updated: true };
}
