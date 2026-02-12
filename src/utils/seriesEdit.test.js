import { describe, it, expect } from "vitest";
import {
  collectRecurringSeriesMembers,
  buildRecurringTargetIdSet,
  dedupeRecurringClonesForItem,
} from "./seriesEdit";

function mk(id, date, seriesId, index = 1, title = "Gas", asset = "Monza") {
  return {
    id,
    title,
    cat: "casa",
    asset,
    date: new Date(`${date}T00:00:00`),
    budget: 10,
    done: false,
    autoPay: true,
    mandatory: false,
    essential: true,
    recurring: {
      enabled: true,
      seriesId,
      interval: 1,
      unit: "mesi",
      index,
      total: 12,
    },
  };
}

describe("series edit helpers", () => {
  it("collects all series members by seriesId", () => {
    const list = [
      mk("a1", "2026-01-31", "sA", 1),
      mk("a2", "2026-02-28", "sA", 2),
      mk("b1", "2026-04-30", "sB", 1),
    ];
    const out = collectRecurringSeriesMembers(list, list[0]);
    expect(out.map(x => x.id)).toEqual(["a1", "a2"]);
  });

  it("builds target id set including live same-series items", () => {
    const list = [
      mk("a1", "2026-01-31", "sA", 1),
      mk("a2", "2026-02-28", "sA", 2),
      mk("a3", "2026-03-31", "sA", 3),
      mk("b1", "2026-04-30", "sB", 1),
    ];
    const ids = buildRecurringTargetIdSet(list, list[1], [list[1]]);
    expect(Array.from(ids).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("dedupes clones with same date, preferring matching seriesId", () => {
    const source = mk("s1", "2026-02-28", "main", 2);
    const cloneSameDayOtherSeries = mk("c1", "2026-02-28", "clone", 2);
    const list = [
      mk("s0", "2026-01-31", "main", 1),
      cloneSameDayOtherSeries,
      source,
      mk("s2", "2026-03-31", "main", 3),
    ];

    const out = dedupeRecurringClonesForItem(list, source);
    expect(out.map(x => x.id)).toEqual(["s0", "s1", "s2"]);
  });
});
