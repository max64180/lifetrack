function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function withStartTime(startDate, year, monthIndex, day) {
  return new Date(
    year,
    monthIndex,
    day,
    startDate.getHours(),
    startDate.getMinutes(),
    startDate.getSeconds(),
    startDate.getMilliseconds()
  );
}

export function getOccurrenceDate(startDate, i, intervalVal, unit) {
  const d = new Date(startDate);
  if (unit === "giorni") {
    d.setDate(startDate.getDate() + (intervalVal * i));
  } else if (unit === "settimane") {
    d.setDate(startDate.getDate() + (intervalVal * 7 * i));
  } else if (unit === "mesi") {
    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth();
    const startDay = startDate.getDate();
    const totalMonths = (startYear * 12) + startMonth + (intervalVal * i);
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = totalMonths - (targetYear * 12);
    const day = Math.min(startDay, daysInMonth(targetYear, targetMonth));
    return withStartTime(startDate, targetYear, targetMonth, day);
  } else if (unit === "anni") {
    const targetYear = startDate.getFullYear() + (intervalVal * i);
    const targetMonth = startDate.getMonth();
    const startDay = startDate.getDate();
    const day = Math.min(startDay, daysInMonth(targetYear, targetMonth));
    return withStartTime(startDate, targetYear, targetMonth, day);
  }
  return d;
}

export function getAutoEndDate() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nextYear = now.getFullYear() + 1;
  return new Date(nextYear, 11, 31, 23, 59, 59, 999);
}

export function computeOccurrences({ startDate, interval, unit, endMode, endDate, count, max = 500 }) {
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
