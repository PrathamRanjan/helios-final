"use client";

// 24-hour Hanoi grid emission factor chart.
// Shows the coal peaks (6-9 PM) in amber and the solar midday window (10 AM-2 PM)
// in emerald. Overlays the portfolio's blended charging profile as green bars,
// and the baseline (home evening) as fading red bars.

import { HOURLY_EF, BASELINE_WEIGHTS } from "@/lib/hanoi/gridMath";

const COAL_PEAK = new Set([6, 7, 8, 18, 19, 20, 21]);
const SOLAR_WINDOW = new Set([10, 11, 12, 13, 14]);

const W = 240;
const H = 68;
const BAR = W / 24;
const EF_MIN = 460;
const EF_MAX = 810;

function efToY(ef: number) {
  return H - 4 - ((ef - EF_MIN) / (EF_MAX - EF_MIN)) * (H - 10);
}

interface Props {
  portfolioProfile: number[];    // blended 24-hr charging weights
  portfolioEFWeighted: number;   // weighted avg gCO₂/kWh for portfolio
  baselineEFWeighted: number;    // weighted avg gCO₂/kWh for baseline (evening charging)
  annualAvgEF: number;           // annual average grid EF (literature, unweighted)
  hasDeployments: boolean;
}

export default function EmissionChart({ portfolioProfile, portfolioEFWeighted, baselineEFWeighted, annualAvgEF, hasDeployments }: Props) {
  const curvePoints = HOURLY_EF.map((ef, h) => `${h * BAR + BAR / 2},${efToY(ef)}`).join(" ");

  return (
    <div>
      {hasDeployments && (
        <div className="flex items-center justify-between mb-1.5 text-[9px] text-white/50">
          <span>
            Annual avg:{" "}
            <span className="text-white/40 font-medium">{annualAvgEF}</span>
            <span className="text-white/30 mx-1">·</span>
            Baseline:{" "}
            <span className="text-amber-300 font-medium">{Math.round(baselineEFWeighted)}</span>
            <span className="text-white/30 ml-0.5">gCO&#8322;/kWh</span>
          </span>
          <span>
            Portfolio:{" "}
            <span className="text-emerald-300 font-medium">{Math.round(portfolioEFWeighted)} gCO&#8322;/kWh</span>
          </span>
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" style={{ height: 76 }}>
        {/* Zone backgrounds */}
        {HOURLY_EF.map((_, h) => {
          const fill = COAL_PEAK.has(h)
            ? "rgba(251,146,60,0.10)"
            : SOLAR_WINDOW.has(h)
            ? "rgba(52,211,153,0.09)"
            : "rgba(255,255,255,0.015)";
          return <rect key={h} x={h * BAR} y={0} width={BAR} height={H} fill={fill} />;
        })}

        {/* Baseline charging bars (red, evening) — shown when deployments exist */}
        {hasDeployments && BASELINE_WEIGHTS.map((w, h) => {
          if (w === 0) return null;
          const barH = Math.max(2, w * (H - 8) * 3.2);
          return (
            <rect key={`b-${h}`} x={h * BAR + 0.5} y={H - barH} width={BAR - 1} height={barH}
              fill="rgba(239,68,68,0.35)" />
          );
        })}

        {/* Portfolio charging bars (green) — the blended profile */}
        {hasDeployments && portfolioProfile.map((w, h) => {
          if (w === 0) return null;
          const barH = Math.max(2, w * (H - 8) * 3.2);
          return (
            <rect key={`p-${h}`} x={h * BAR + 0.5} y={H - barH} width={BAR - 1} height={barH}
              fill="rgba(52,211,153,0.55)" />
          );
        })}

        {/* EF curve */}
        <polyline points={curvePoints} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={1} strokeLinejoin="round" />

        {/* Annual avg EF reference line */}
        <line x1={0} x2={W} y1={efToY(annualAvgEF)} y2={efToY(annualAvgEF)}
          stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} strokeDasharray="2,2" />
        <text x={2} y={efToY(annualAvgEF) - 2} fontSize={4} fill="rgba(255,255,255,0.25)">
          {annualAvgEF} avg
        </text>

        {/* Zone labels — solar window & coal peak */}
        <text x={12 * BAR} y={6} textAnchor="middle" fontSize={4} fill="rgba(52,211,153,0.45)" fontWeight="500">
          Solar window
        </text>
        <text x={19.5 * BAR} y={6} textAnchor="middle" fontSize={4} fill="rgba(251,146,60,0.45)" fontWeight="500">
          Coal peak
        </text>

        {/* Hour labels */}
        {[0, 6, 10, 14, 18, 23].map(h => (
          <text key={h} x={h * BAR + BAR / 2} y={H + 10}
            textAnchor="middle" fontSize={4.5} fill="rgba(255,255,255,0.28)">
            {h}h
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5 text-[8.5px] text-white/35">
        <span className="flex items-center gap-1">
          <span className="w-2 h-1.5 rounded-sm inline-block bg-amber-400/40" /> Coal peak
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-1.5 rounded-sm inline-block bg-emerald-400/40" /> Solar window
        </span>
        {hasDeployments && (
          <>
            <span className="flex items-center gap-1">
              <span className="w-2 h-1.5 rounded-sm inline-block bg-red-400/60" /> Baseline (home)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-1.5 rounded-sm inline-block bg-emerald-400/60" /> Your portfolio
            </span>
          </>
        )}
      </div>
    </div>
  );
}
