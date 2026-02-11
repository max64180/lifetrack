import { describe, it, expect } from "vitest";
import { computeOccurrences, getOccurrenceDate } from "./recurrence";

const dateKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

describe("recurrence helpers", () => {
  it("creates a fixed number of monthly occurrences", () => {
    const start = new Date("2026-01-15T00:00:00");
    const dates = computeOccurrences({
      startDate: start,
      interval: 1,
      unit: "mesi",
      endMode: "count",
      count: 3,
    });
    expect(dates).toHaveLength(3);
    expect(dates[0].getMonth()).toBe(0);
    expect(dates[1].getMonth()).toBe(1);
    expect(dates[2].getMonth()).toBe(2);
  });

  it("stops at end date when using endMode=date", () => {
    const start = new Date("2026-01-01T00:00:00");
    const dates = computeOccurrences({
      startDate: start,
      interval: 1,
      unit: "mesi",
      endMode: "date",
      endDate: "2026-03-10",
    });
    const last = dates[dates.length - 1];
    expect(last.getMonth()).toBeLessThanOrEqual(2);
  });

  it("computes weekly occurrences", () => {
    const start = new Date("2026-02-01T00:00:00");
    const second = getOccurrenceDate(start, 1, 1, "settimane");
    expect(second.getDate()).toBe(8);
  });

  it("keeps month-end alignment for monthly series", () => {
    const start = new Date("2026-01-31T00:00:00");
    const dates = computeOccurrences({
      startDate: start,
      interval: 1,
      unit: "mesi",
      endMode: "count",
      count: 4,
    });
    const labels = dates.map(dateKey);
    expect(labels).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("keeps valid yearly date for leap-day series", () => {
    const start = new Date("2024-02-29T00:00:00");
    const dates = computeOccurrences({
      startDate: start,
      interval: 1,
      unit: "anni",
      endMode: "count",
      count: 3,
    });
    const labels = dates.map(dateKey);
    expect(labels).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });
});
