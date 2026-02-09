import { describe, it, expect } from "vitest";
import { computeOccurrences, getOccurrenceDate } from "./recurrence";

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
});
