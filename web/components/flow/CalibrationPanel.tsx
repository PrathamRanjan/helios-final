"use client";

// Model-vs-reality calibration — the credibility artifact for the systems judge.
// Compares HELIO's parameters/outputs to officially measured Singapore figures.
// Honest strength labels: direct match / conservative / directional.

import calib from "@/data/assumptions/calibration.json";

const STRENGTH: Record<string, { label: string; cls: string }> = {
  direct: { label: "direct match", cls: "text-emerald-300" },
  conservative: { label: "conservative", cls: "text-sky-300" },
  directional: { label: "directional", cls: "text-amber-300" },
};

export default function CalibrationPanel({ compact = false }: { compact?: boolean }) {
  const checks = (calib as any).checks as {
    metric: string; model: string; measured: string; verdict: string; strength: string; source: string;
  }[];

  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="text-[10px] text-white/50 print:text-black/60">
          HELIO parameters checked against measured Singapore outcomes — validation, not just assumption.
        </div>
      )}
      {checks.map((c) => {
        const st = STRENGTH[c.strength] ?? STRENGTH.directional;
        return (
          <div key={c.metric} className="rounded-md bg-white/[0.03] print:bg-black/5 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-white/80 print:text-black/80">{c.metric}</span>
              <span className={`text-[9px] ${st.cls}`}>{st.label}</span>
            </div>
            <div className="text-[9.5px] text-white/55 print:text-black/60 mt-0.5">
              model <span className="text-white/80 print:text-black">{c.model}</span> · measured{" "}
              <span className="text-white/80 print:text-black">{c.measured}</span>
            </div>
            <div className="text-[8.5px] text-white/35 print:text-black/45 mt-0.5">{c.verdict} — {c.source}</div>
          </div>
        );
      })}
    </div>
  );
}
