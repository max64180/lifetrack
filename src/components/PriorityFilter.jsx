import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export default function PriorityFilter({
  activeTab,
  filterMandatory,
  setFilterMandatory,
  filterAutoPay,
  setFilterAutoPay,
  filterManual,
  setFilterManual,
  filterEstimateMissing,
  setFilterEstimateMissing,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const options = [
    { id:"all", label: t("filters.all") },
    { id:"mandatory", label: t("filters.mandatory") },
    { id:"manual", label: t("filters.manualPay", { defaultValue:"Da pagare" }) },
    { id:"estimate", label: t("filters.estimate") },
    { id:"auto", label: t("filters.autoPay") },
  ];

  const current = useMemo(() => {
    if (filterMandatory) return "mandatory";
    if (filterManual) return "manual";
    if (filterEstimateMissing) return "estimate";
    if (filterAutoPay) return "auto";
    return "all";
  }, [filterMandatory, filterManual, filterEstimateMissing, filterAutoPay]);

  const applyPriority = (id) => {
    setFilterMandatory(false);
    setFilterManual(false);
    setFilterEstimateMissing(false);
    setFilterAutoPay(false);
    if (id === "mandatory") setFilterMandatory(true);
    if (id === "manual") setFilterManual(true);
    if (id === "estimate") setFilterEstimateMissing(true);
    if (id === "auto") setFilterAutoPay(true);
    setOpen(false);
  };

  const isActive = current !== "all";

  return (
    <div style={{ background:"#f5f4f0", paddingBottom:8 }}>
      <div style={{ padding:"10px 18px 4px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ position:"relative", display:"inline-block" }}>
          <button onClick={() => setOpen(o => !o)} style={{
            border:`1px solid ${isActive ? "#2d2b26" : "#e8e6e0"}`,
            background: isActive ? "#2d2b26" : "#fff",
            borderRadius:14, padding:"8px 12px",
            fontSize:12, fontWeight:800,
            color: isActive ? "#fff" : "#2d2b26",
            cursor:"pointer", minHeight:36,
            display:"flex", alignItems:"center", gap:8,
            boxShadow: isActive ? "0 6px 16px rgba(0,0,0,.12)" : "none"
          }}>
            <span style={{ fontSize:10, letterSpacing:".4px", opacity:.75, textTransform:"uppercase" }}>
              {t("filters.priority", { defaultValue:"Priorità" })}
            </span>
            <strong style={{ fontSize:12 }}>
              {options.find(o => o.id === current)?.label}
            </strong>
            <span style={{ fontSize:12, color: isActive ? "rgba(255,255,255,.8)" : "#8a877f" }}>▾</span>
          </button>
          {open && (
            <div style={{
              position:"absolute", left:0, top:"calc(100% + 6px)", minWidth:220,
              background:"#fff", border:"1px solid #e8e6e0", borderRadius:12,
              boxShadow:"0 10px 24px rgba(0,0,0,.08)", zIndex:90, overflow:"hidden"
            }}>
              {options.map(opt => (
                <button key={opt.id} onClick={() => applyPriority(opt.id)} style={{
                  width:"100%", textAlign:"left", padding:"10px 12px", border:"none", cursor:"pointer",
                  background: current === opt.id ? "#f5f4f0" : "#fff",
                  fontSize:12, fontWeight:700, color:"#2d2b26"
                }}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
          {isActive && (
            <button onClick={() => applyPriority("all")} style={{
              border:"none", background:"transparent", cursor:"pointer",
              color:"#E53935", fontSize:12, fontWeight:700, padding:"6px 4px",
              textDecoration:"underline", textUnderlineOffset:3
            }}>
              {t("filters.reset", { defaultValue:"Reset filtri" })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
