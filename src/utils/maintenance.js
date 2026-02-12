function toDateInputValue(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function deriveNextMaintenanceDate({ formDate, nextDate, enableNext, defaultMonths = 12 }) {
  if (!enableNext) return "";
  if (nextDate) return nextDate;
  const base = new Date(`${formDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setMonth(base.getMonth() + defaultMonths);
  return toDateInputValue(base);
}

export function shouldCreateNextDeadline({ enableNext, createDeadline, nextDate }) {
  return Boolean(enableNext && createDeadline && nextDate);
}

