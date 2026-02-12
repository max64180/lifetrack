import { describe, it, expect } from "vitest";
import { deriveNextMaintenanceDate, shouldCreateNextDeadline } from "./maintenance";

describe("maintenance helpers", () => {
  it("uses explicit nextDate when provided", () => {
    const next = deriveNextMaintenanceDate({
      formDate: "2026-01-15",
      nextDate: "2026-06-15",
      enableNext: true,
    });
    expect(next).toBe("2026-06-15");
  });

  it("falls back to +12 months when scheduling is enabled and nextDate is empty", () => {
    const next = deriveNextMaintenanceDate({
      formDate: "2026-01-15",
      nextDate: "",
      enableNext: true,
    });
    expect(next).toBe("2027-01-15");
  });

  it("does not generate next date when scheduling is disabled", () => {
    const next = deriveNextMaintenanceDate({
      formDate: "2026-01-15",
      nextDate: "",
      enableNext: false,
    });
    expect(next).toBe("");
  });

  it("creates next deadline only when all gating flags are present", () => {
    expect(shouldCreateNextDeadline({ enableNext: true, createDeadline: true, nextDate: "2027-01-15" })).toBe(true);
    expect(shouldCreateNextDeadline({ enableNext: true, createDeadline: false, nextDate: "2027-01-15" })).toBe(false);
    expect(shouldCreateNextDeadline({ enableNext: true, createDeadline: true, nextDate: "" })).toBe(false);
    expect(shouldCreateNextDeadline({ enableNext: false, createDeadline: true, nextDate: "2027-01-15" })).toBe(false);
  });
});

