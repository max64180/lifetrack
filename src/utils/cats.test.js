import { describe, it, expect } from "vitest";
import { mergeCategorySets, normalizeCategories } from "./cats";

describe("categories sync safety", () => {
  it("normalizes custom categories with stable defaults", () => {
    const raw = [
      { id: "streaming_e_cloud", label: "Streaming e Cloud", iconKey: "cloud", color: "#C77DBA" },
    ];
    const normalized = normalizeCategories(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe("streaming_e_cloud");
    expect(normalized[0].label).toBe("Streaming e Cloud");
    expect(normalized[0].iconKey).toBe("cloud");
    expect(normalized[0].assets).toEqual([]);
    expect(normalized[0].light).toBe("#C77DBA22");
  });

  it("keeps local custom categories when remote payload is behind", () => {
    const remote = [
      { id: "casa", label: "Casa", icon: "🏠", color: "#E8855D", light: "#FFF0EC", assets: [] },
      { id: "auto", label: "Auto", icon: "🚗", color: "#5B8DD9", light: "#EBF2FC", assets: [] },
    ];
    const local = [
      ...remote,
      { id: "streaming_e_cloud", label: "Streaming e Cloud", iconKey: "cloud", color: "#C77DBA", light: "#F8EEF7", assets: ["Google One"] },
    ];
    const merged = mergeCategorySets(remote, local);
    const ids = merged.map((cat) => cat.id);
    expect(ids).toContain("streaming_e_cloud");
    expect(merged.find((cat) => cat.id === "streaming_e_cloud")?.assets).toEqual(["Google One"]);
  });
});
