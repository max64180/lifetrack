export function applySharedDeadlineFilters(list, filters = {}) {
  let out = Array.isArray(list) ? list : [];
  if (filters.filterCat) out = out.filter(d => d.cat === filters.filterCat);
  if (filters.filterAsset) out = out.filter(d => d.asset === filters.filterAsset);
  if (filters.filterMandatory) out = out.filter(d => d.mandatory);
  if (filters.filterRecurring) out = out.filter(d => d.recurring && d.recurring.enabled);
  if (filters.filterAutoPay) out = out.filter(d => d.autoPay);
  if (filters.filterManual) out = out.filter(d => !d.autoPay);
  if (filters.filterEssential) out = out.filter(d => d.essential);
  if (filters.filterEstimateMissing) out = out.filter(d => d.estimateMissing);
  if (filters.filterPet) out = out.filter(d => d.petId);
  return out;
}

export function matchByTab(item, activeTab, today) {
  const now = today instanceof Date ? today : new Date();
  if (activeTab === "done") return item.done;
  if (activeTab === "overdue") return item.date < now && !item.done;
  if (activeTab === "timeline") return item.date >= now && !item.done;
  return true;
}

export function filterByTabAndPeriod(list, { activeTab, periodStart, periodEnd, today, filters }) {
  const base = (Array.isArray(list) ? list : []).filter(d => {
    if (!matchByTab(d, activeTab, today)) return false;
    return d.date >= periodStart && d.date <= periodEnd;
  });
  return applySharedDeadlineFilters(base, filters);
}

export function filterByTabAnyPeriod(list, { activeTab, today, filters }) {
  const base = (Array.isArray(list) ? list : []).filter(d => matchByTab(d, activeTab, today));
  return applySharedDeadlineFilters(base, filters);
}

export function collectAvailableMonths(list) {
  const months = new Set();
  (Array.isArray(list) ? list : []).forEach(d => {
    if (!(d?.date instanceof Date) || Number.isNaN(d.date.getTime())) return;
    months.add(d.date.getFullYear() * 12 + d.date.getMonth());
  });
  return Array.from(months).sort((a, b) => a - b);
}

export function collectAvailableYears(list) {
  const years = new Set();
  (Array.isArray(list) ? list : []).forEach(d => {
    if (!(d?.date instanceof Date) || Number.isNaN(d.date.getTime())) return;
    years.add(d.date.getFullYear());
  });
  return Array.from(years).sort((a, b) => a - b);
}

export function findAdjacentMonths(availableMonths, year, month) {
  const current = year * 12 + month;
  const prev = availableMonths.filter(m => m < current).pop();
  const next = availableMonths.find(m => m > current);
  return {
    prevMonth: typeof prev === "number" ? prev : null,
    nextMonth: typeof next === "number" ? next : null,
  };
}
