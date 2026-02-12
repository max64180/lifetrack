import { describe, it, expect } from "vitest";
import {
  filterByTabAndPeriod,
  filterByTabAnyPeriod,
  collectAvailableMonths,
  collectAvailableYears,
  findAdjacentMonths,
} from "./deadlineFilters";

function mk(id, date, { done = false, mandatory = false, essential = false } = {}) {
  return {
    id,
    title: String(id),
    cat: "casa",
    asset: "Monza",
    date: new Date(`${date}T00:00:00`),
    done,
    mandatory,
    essential,
    recurring: null,
  };
}

describe("deadline filters", () => {
  const TODAY = new Date("2026-02-12T00:00:00");
  const janStart = new Date("2026-01-01T00:00:00");
  const janEnd = new Date("2026-01-31T23:59:59");
  const febStart = new Date("2026-02-01T00:00:00");
  const febEnd = new Date("2026-02-28T23:59:59");

  it("keeps overdue navigation candidates from previous months", () => {
    const list = [mk("jan-overdue", "2026-01-31"), mk("feb-future", "2026-02-25")];
    const nav = filterByTabAnyPeriod(list, { activeTab: "overdue", today: TODAY, filters: {} });
    const months = collectAvailableMonths(nav);
    expect(months).toEqual([2026 * 12 + 0]);
  });

  it("filters timeline only in selected period", () => {
    const list = [mk("jan", "2026-01-31"), mk("feb", "2026-02-25")];
    const janTimeline = filterByTabAndPeriod(list, {
      activeTab: "timeline",
      periodStart: janStart,
      periodEnd: janEnd,
      today: TODAY,
      filters: {},
    });
    const febTimeline = filterByTabAndPeriod(list, {
      activeTab: "timeline",
      periodStart: febStart,
      periodEnd: febEnd,
      today: TODAY,
      filters: {},
    });
    expect(janTimeline).toHaveLength(0);
    expect(febTimeline.map(x => x.id)).toEqual(["feb"]);
  });

  it("computes previous month correctly", () => {
    const items = [mk("jan-overdue", "2026-01-31"), mk("mar-overdue", "2026-03-01")];
    const nav = filterByTabAnyPeriod(items, { activeTab: "overdue", today: new Date("2026-04-01T00:00:00"), filters: {} });
    const months = collectAvailableMonths(nav);
    const adj = findAdjacentMonths(months, 2026, 1);
    expect(adj.prevMonth).toBe(2026 * 12 + 0);
    expect(adj.nextMonth).toBe(2026 * 12 + 2);
  });

  it("collects years for year navigation", () => {
    const years = collectAvailableYears([mk("a", "2025-12-01"), mk("b", "2027-01-01"), mk("c", "2026-05-01")]);
    expect(years).toEqual([2025, 2026, 2027]);
  });
});
