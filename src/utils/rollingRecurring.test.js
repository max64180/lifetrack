import { describe, it, expect } from "vitest";
import { extendAutoRecurringSeries } from "./rollingRecurring";

function mk({ id, date, index, total = 2, endMode = "auto", unit = "mesi", seriesId = "s1" }) {
  return {
    id,
    title: "Luce",
    cat: "casa",
    asset: "Monza",
    date: new Date(`${date}T00:00:00`),
    done: false,
    skipped: false,
    documents: [],
    recurring: {
      enabled: true,
      seriesId,
      interval: 1,
      unit,
      index,
      total,
      endMode,
      endDate: "",
    },
  };
}

const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("rolling recurring", () => {
  it("extends auto monthly series up to horizon with month-end alignment", () => {
    const initial = [
      mk({ id: "a1", date: "2026-01-31", index: 1 }),
      mk({ id: "a2", date: "2026-02-28", index: 2 }),
    ];
    const horizon = new Date("2026-04-30T23:59:59");
    const out = extendAutoRecurringSeries(initial, { horizon });
    const ordered = out.deadlines
      .filter(d => d.recurring?.seriesId === "s1")
      .sort((a, b) => a.recurring.index - b.recurring.index);
    expect(out.updated).toBe(true);
    expect(out.addedCount).toBe(2);
    expect(ordered.map(d => toKey(d.date))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(ordered.every(d => d.recurring.total === 4)).toBe(true);
  });

  it("does not extend non-auto recurring series", () => {
    const initial = [
      mk({ id: "a1", date: "2026-01-31", index: 1, endMode: "count" }),
      mk({ id: "a2", date: "2026-02-28", index: 2, endMode: "count" }),
    ];
    const out = extendAutoRecurringSeries(initial, { horizon: new Date("2026-12-31T23:59:59") });
    expect(out.updated).toBe(false);
    expect(out.addedCount).toBe(0);
    expect(out.deadlines).toEqual(initial);
  });

  it("is idempotent once coverage reaches horizon", () => {
    const initial = [
      mk({ id: "a1", date: "2026-01-31", index: 1 }),
      mk({ id: "a2", date: "2026-02-28", index: 2 }),
    ];
    const horizon = new Date("2026-03-31T23:59:59");
    const first = extendAutoRecurringSeries(initial, { horizon });
    const second = extendAutoRecurringSeries(first.deadlines, { horizon });
    expect(first.updated).toBe(true);
    expect(second.updated).toBe(false);
    expect(second.addedCount).toBe(0);
  });
});
