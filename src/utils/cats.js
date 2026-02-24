import { DEFAULT_CATS } from "../data/constants";

export const getCat = (cats, id) => cats.find(c => c.id === id) || cats[0];

export function normalizeCategories(raw = []) {
  if (!Array.isArray(raw)) return [];
  const defaultsById = new Map((DEFAULT_CATS || []).map((cat) => [String(cat.id), cat]));
  return raw
    .map((cat, index) => {
      if (!cat || typeof cat !== "object") return null;
      const fallbackId = String(cat.label || `cat_${index}`).toLowerCase().replace(/\s+/g, "_");
      const id = String(cat.id || fallbackId);
      const base = defaultsById.get(id) || {};
      const color = cat.color || base.color || "#8a877f";
      return {
        ...base,
        ...cat,
        id,
        label: cat.label || base.label || id,
        color,
        light: cat.light || base.light || `${color}22`,
        assets: Array.isArray(cat.assets) ? cat.assets.filter(Boolean) : [],
        iconKey: typeof cat.iconKey === "string" ? cat.iconKey : (typeof base.iconKey === "string" ? base.iconKey : ""),
      };
    })
    .filter(Boolean);
}

export function mergeCategorySets(remoteRaw, localRaw) {
  const remote = normalizeCategories(remoteRaw);
  const local = normalizeCategories(localRaw);
  if (!remote.length) return local.length ? local : normalizeCategories(DEFAULT_CATS);
  const merged = new Map(remote.map((cat) => [String(cat.id), cat]));
  local.forEach((cat) => {
    const id = String(cat.id);
    if (!merged.has(id)) merged.set(id, cat);
  });
  return Array.from(merged.values());
}
