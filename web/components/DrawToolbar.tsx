"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Pencil, X, Check, Undo2, Loader2 } from "lucide-react";

interface Props {
  visible: boolean;
  screening?: boolean;
  vertexCount: number;
  areaM2: number;
  roofType: string;
  onRoofTypeChange: (t: string) => void;
  onUndo: () => void;
  onCancel: () => void;
  onCalculate: () => void;
  loading: boolean;
}

const ROOF_TYPES = [
  { id: "flat", label: "Flat roof", desc: "Large unobstructed roof · 65% usable" },
  { id: "pitched_simple", label: "Pitched (simple)", desc: "Gable or shed · 45% usable" },
  { id: "pitched_complex", label: "Pitched (complex)", desc: "Multi-faceted · 30% usable" },
  { id: "partial_obstructed", label: "Partially obstructed", desc: "HVAC / skylights · 40% usable" },
];

export default function DrawToolbar({
  visible,
  screening = false,
  vertexCount,
  areaM2,
  roofType,
  onRoofTypeChange,
  onUndo,
  onCancel,
  onCalculate,
  loading,
}: Props) {
  const canCalculate = vertexCount >= 3 && (!screening || areaM2 > 0) && !loading;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          style={screening ? { x: "-50%" } : undefined}
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-auto ${screening ? "w-[calc(100vw-2rem)] max-w-[800px]" : ""}`}
        >
          <div className={`glass-strong rounded-2xl shadow-panel px-4 py-3 flex items-center gap-4 ${screening ? "flex-wrap" : "min-w-[640px]"}`}>
            <div className="flex items-center gap-2 text-solar-300">
              <Pencil className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-[0.15em] font-medium">
                Draw your roof
              </span>
            </div>

            <div className="h-6 w-px bg-white/10" />

            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-wider text-white/45">
                Vertices · Area
              </span>
              <span className="text-sm text-white font-mono">
                {vertexCount} pts ·{" "}
                <span className="text-solar-200">
                  {areaM2 >= 1
                    ? `${Math.round(areaM2).toLocaleString()} m²`
                    : "—"}
                </span>
              </span>
            </div>

            <div className="h-6 w-px bg-white/10" />

            <select
              aria-label="Roof type"
              disabled={loading}
              value={roofType}
              onChange={(e) => onRoofTypeChange(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white/85 outline-none focus:border-solar-400/40 cursor-pointer"
              title={ROOF_TYPES.find((r) => r.id === roofType)?.desc}
            >
              {ROOF_TYPES.map((r) => (
                <option key={r.id} value={r.id} className="bg-bg">
                  {r.label}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            <button
              onClick={onUndo}
              disabled={vertexCount === 0 || loading}
              className="w-9 h-9 rounded-lg bg-white/[0.05] hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              title="Undo last point"
            >
              <Undo2 className="w-4 h-4 text-white/75" />
            </button>
            <button
              onClick={onCancel}
              className="w-9 h-9 rounded-lg bg-white/[0.05] hover:bg-rose-500/20 disabled:opacity-30 flex items-center justify-center transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4 text-white/75" />
            </button>
            <button
              onClick={onCalculate}
              disabled={!canCalculate}
              className="h-9 px-4 rounded-lg btn-solar disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 text-[12.5px] font-medium"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {loading ? "Calculating…" : "Calculate"}
            </button>
          </div>
          <div className="mt-2 text-center text-[10.5px] text-white/40">
            Click anywhere on the 3D map to drop a corner.{" "}
            <span className="text-white/65">
              {vertexCount < 3
                ? `Need ${3 - vertexCount} more point${3 - vertexCount === 1 ? "" : "s"}.`
                : screening ? "Area-based screening estimate; survey required." : "Tier C ±10% — most defensible result."}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}