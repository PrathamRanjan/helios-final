"use client";

// HELIO Hanoi — Click-to-Deploy EV Charging & Grid Decarbonization sandbox.
//
// The planner's decision: which candidate sites to fund with a fixed budget.
// Click a pin to deploy → budget deducts, CO₂ counter updates, emission
// chart shifts. Each site has its own charging profile (university=solar
// window, metro=commuter peaks, office=daytime) so different portfolios
// produce different carbon outcomes.

import dynamic from "next/dynamic";
import { useEffect, useState, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Zap, Sparkles, RotateCcw, AlertTriangle } from "lucide-react";
import EmissionChart from "@/components/hanoi/EmissionChart";
import SiteAnalysisPanel from "@/components/hanoi/SiteAnalysisPanel";
import BackToMissionControl from "@/components/BackToMissionControl";
import CityRail from "@/components/city/CityRail";
import {
  solveSite,
  solvePortfolio,
  optimizePortfolio,
  getPortfolioProfile,
  BASELINE_EF_WEIGHTED,
  ANNUAL_AVG_EF,
  CONFIDENCE,
  type CandidateSite,
  type PortfolioResult,
} from "@/lib/hanoi/gridMath";

const HanoiMap = dynamic(() => import("@/components/hanoi/HanoiMap"), { ssr: false });

const BUDGET_PRESETS = [500_000, 1_000_000, 1_500_000, 2_000_000];

interface ExistingCharger {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export default function HanoiPage() {
  const [totalBudget, setTotalBudget] = useState(1_500_000);
  const [deployedIds, setDeployedIds] = useState<Set<string>>(new Set());
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // Map data
  const [existingChargers, setExistingChargers] = useState<ExistingCharger[]>([]);
  const [candidates, setCandidates] = useState<CandidateSite[]>([]);
  const [ringRoadCoords, setRingRoadCoords] = useState<[number, number][] | null>(null);

  // Load geo data
  useEffect(() => {
    fetch("/api/hanoi/chargers")
      .then((r) => r.json())
      .then((d) => {
        setExistingChargers(d.existing ?? []);
        setCandidates(d.candidates ?? []);
      })
      .catch(() => {});

    fetch("/api/hanoi/ring-road")
      .then((r) => r.json())
      .then((d) => setRingRoadCoords(d.coordinates?.[0] ?? null))
      .catch(() => {});
  }, []);

  // Derived state
  const deployedSites = useMemo(
    () => candidates.filter((s) => deployedIds.has(s.id)),
    [candidates, deployedIds]
  );
  const portfolio = useMemo(() => solvePortfolio(deployedSites), [deployedSites]);
  const spentBudget = portfolio.totalCapexUSD;
  const remainingBudget = totalBudget - spentBudget;
  const selectedSite = candidates.find((s) => s.id === selectedSiteId) ?? null;
  const portfolioProfile = useMemo(
    () => getPortfolioProfile(deployedSites, candidates.length),
    [deployedSites, candidates.length]
  );

  // Deploy / undeploy a site
  // Fix: compute spent from prev inside the updater to avoid stale closure
  const toggleSite = useCallback(
    (siteId: string) => {
      setDeployedIds((prev) => {
        const next = new Set(prev);
        if (next.has(siteId)) {
          next.delete(siteId);
          return next;
        }
        const site = candidates.find((s) => s.id === siteId);
        if (!site) return prev;
        let spent = 0;
        for (const id of prev) {
          const s = candidates.find((c) => c.id === id);
          if (s) spent += s.capex_usd;
        }
        if (spent + site.capex_usd <= totalBudget) {
          next.add(siteId);
        }
        return next;
      });
    },
    [candidates, totalBudget]
  );

  // Auto-optimize: greedy by cost/tonne
  const autoOptimize = useCallback(() => {
    const optimal = optimizePortfolio(candidates, totalBudget);
    setDeployedIds(optimal);
  }, [candidates, totalBudget]);

  // Clear all
  const clearAll = useCallback(() => {
    setDeployedIds(new Set());
  }, []);

  // Handle map click — deploy/undeploy on single click, show panel
  const handleCandidateClick = useCallback(
    (site: CandidateSite) => {
      setSelectedSiteId(site.id);
    },
    []
  );

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const fmtK = (n: number) => `$${(n / 1_000).toFixed(0)}K`;
  const fmtM = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-bg text-white grain">
      <HanoiMap
        existingChargers={existingChargers}
        candidateChargers={candidates}
        deployedIds={deployedIds}
        ringRoadCoords={ringRoadCoords}
        onCandidateClick={handleCandidateClick}
        remainingBudget={remainingBudget}
      />

      {/* Site analysis panel — right side */}
      <SiteAnalysisPanel
        site={selectedSite}
        siteResult={selectedSite ? solveSite(selectedSite) : null}
        isDeployed={selectedSite ? deployedIds.has(selectedSite.id) : false}
        canDeploy={selectedSite ? remainingBudget >= selectedSite.capex_usd : false}
        onDeploy={() => selectedSite && toggleSite(selectedSite.id)}
        onClose={() => setSelectedSiteId(null)}
      />

      {/* Brand — top left */}
      <div className="absolute top-5 left-5 z-20 flex flex-col gap-2 items-start">
        <div className="flex items-center gap-2">
          <BackToMissionControl />
          <CityRail current="VN" />
        </div>
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-400/20 text-emerald-300 flex items-center justify-center">
            <Zap size={20} />
          </div>
          <div>
            <div className="font-display text-lg leading-none text-solar-gradient">HELIO Hanoi</div>
            <div className="text-white/50 text-[11px] mt-1">Click sites to deploy · grid decarbonization sandbox</div>
          </div>
        </div>
      </div>

      {/* Budget presets — top center */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        <span className="text-[10px] text-white/40 mr-1">Budget:</span>
        {BUDGET_PRESETS.map((b) => (
          <button
            key={b}
            onClick={() => setTotalBudget(b)}
            className={`px-3 py-1.5 rounded-lg text-[11px] border transition-all ${
              totalBudget === b
                ? "bg-emerald-400 text-black font-semibold border-emerald-400"
                : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
            }`}
          >
            {fmtM(b)}
          </button>
        ))}
      </div>

      {/* Right sidebar */}
      <div className={`absolute top-5 bottom-5 z-20 w-[340px] flex flex-col gap-3 transition-all duration-200 ${selectedSite ? "right-[420px]" : "right-5"}`}>

        {/* Policy alert */}
        <div className="glass rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-[11px] font-medium text-amber-300">ICE Ban — July 1, 2026</div>
            <div className="text-[10px] text-white/50 mt-0.5 leading-snug">
              450,000+ motorbikes go electric inside Ring Road 1 (Directive 20/CT-TTg).
              Without managed charging, evening coal peaks reach 762 gCO&#8322;/kWh.
            </div>
          </div>
        </div>

        {/* Portfolio stats */}
        <div className="glass-strong rounded-2xl p-4 flex-1 overflow-y-auto flex flex-col gap-4">

          {/* Budget bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-white/60 font-medium">Budget</span>
              <span className="text-[11px] font-medium">
                <span className="text-emerald-300">{fmtK(spentBudget)}</span>
                <span className="text-white/30"> / {fmtM(totalBudget)}</span>
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400/70 transition-all duration-300"
                style={{ width: `${Math.min(100, (spentBudget / totalBudget) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-white/30 mt-0.5">
              <span>{deployedIds.size} sites deployed</span>
              <span>{fmtK(remainingBudget)} remaining</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={autoOptimize}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-400/15 text-emerald-300 text-[11px] font-medium hover:bg-emerald-400/25 transition-colors border border-emerald-400/20"
            >
              <Sparkles size={12} /> HELIO Recommends
            </button>
            <button
              onClick={clearAll}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] text-white/50 text-[11px] hover:bg-white/[0.08] transition-colors border border-white/[0.08]"
            >
              <RotateCcw size={12} /> Clear
            </button>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="CO&#8322; saved"
              value={portfolio.totalCO2SavedTonnes > 0 ? `${fmt(Math.round(portfolio.totalCO2SavedTonnes))} t` : "0 t"}
              sub="per year"
              color="emerald"
            />
            <StatCard
              label="Peak shaved"
              value={portfolio.totalPeakShavingMW > 0 ? `${portfolio.totalPeakShavingMW.toFixed(1)} MW` : "0 MW"}
              sub="6-9 PM coal"
              color="amber"
            />
            <StatCard
              label="Cost / tonne"
              value={portfolio.avgCostPerTonne > 0 ? `$${fmt(Math.round(portfolio.avgCostPerTonne))}` : "--"}
              sub={portfolio.avgLevelizedCostPerTonne > 0 ? `≈$${fmt(Math.round(portfolio.avgLevelizedCostPerTonne))}/t lifecycle` : "USD/tCO&#8322;"}
              color="sky"
            />
          </div>

          {/* Deployed sites list */}
          {deployedSites.length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wide text-white/35 mb-2">Deployed Sites</div>
              <div className="flex flex-col gap-1">
                {deployedSites.map((site) => {
                  const r = solveSite(site);
                  return (
                    <button
                      key={site.id}
                      onClick={() => setSelectedSiteId(site.id)}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          site.recommended_type === "dc_fast" ? "bg-sky-400" :
                          site.recommended_type === "solar_canopy" ? "bg-amber-400" : "bg-emerald-400"
                        }`} />
                        <span className="text-[10.5px] text-white/70 truncate">{site.name}</span>
                      </div>
                      <span className="text-[9.5px] text-emerald-300/70 shrink-0 ml-2">
                        {Math.round(r.annualCO2SavedTonnes)}t
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Emission chart */}
          <div>
            <div className="text-[10px] text-white/50 font-medium mb-2">
              24-hr Grid Emission Factor — Hanoi
              <span className="text-white/25 ml-1.5">(annual avg {ANNUAL_AVG_EF} · weighted baseline {Math.round(BASELINE_EF_WEIGHTED)})</span>
            </div>
            <EmissionChart
              portfolioProfile={portfolioProfile}
              portfolioEFWeighted={portfolio.portfolioEFWeighted}
              baselineEFWeighted={BASELINE_EF_WEIGHTED}
              annualAvgEF={ANNUAL_AVG_EF}
              hasDeployments={deployedSites.length > 0}
            />
          </div>

          {/* Data provenance */}
          <div className="text-[8.5px] leading-snug text-white/25 border-t border-white/[0.06] pt-2 space-y-0.5">
            <div>
              Grid EF (annual avg): <span className="text-white/40">{ANNUAL_AVG_EF} gCO&#8322;/kWh</span>
              <span className="text-white/20"> — HUST 2024 · {CONFIDENCE.annualAvgEF.level}</span>
            </div>
            <div>
              Grid EF (weighted baseline): <span className="text-white/40">{Math.round(BASELINE_EF_WEIGHTED)} gCO&#8322;/kWh</span>
              <span className="text-white/20"> — 80% evening charging · {CONFIDENCE.baselineWeights.level}</span>
            </div>
            <div>
              Hourly EF curve: <span className="text-white/20">{CONFIDENCE.hourlyEF.level}</span>
            </div>
            <div>
              Charging profiles: <span className="text-white/20">{CONFIDENCE.categoryProfiles.level}</span>
            </div>
            <div>
              Daily kWh: <span className="text-white/20">{CONFIDENCE.dailyKwhScooter.label}; {CONFIDENCE.dailyKwhCar.label}</span>
            </div>
            <div>
              Daily EVs/site: <span className="text-white/20">{CONFIDENCE.dailyEvs.level}</span>
            </div>
            <div>
              CAPEX: <span className="text-white/20">{CONFIDENCE.capex.label}</span>
            </div>
          </div>
        </div>

        {/* Map legend */}
        <div className="glass rounded-xl px-3 py-2.5 text-[10px] flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60 border border-red-400/60 inline-block" />
            <span className="text-white/60">Ring Road 1 — ICE ban zone</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#a0a0aa] inline-block" />
            <span className="text-white/60">Existing VinFast chargers (203)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
            <span className="text-white/60">L2 AC — workplace / residential</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
            <span className="text-white/60">DC Fast — metro / transit / govt</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            <span className="text-white/60">Solar Canopy — university campuses</span>
          </div>
          <div className="text-white/30 text-[9px] pt-0.5">Click any site to inspect & deploy</div>
        </div>
      </div>

      {/* Bottom-left carbon delta banner */}
      <AnimatePresence>
        {portfolio.totalCO2SavedTonnes > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-5 left-5 z-20 glass-strong rounded-2xl px-5 py-3 flex items-center gap-4"
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-400/15 text-emerald-300 flex items-center justify-center">
              <Zap size={18} />
            </div>
            <div>
              <div className="text-sm font-medium text-white">
                {fmt(Math.round(portfolio.totalCO2SavedTonnes))} tCO&#8322; avoided per year
              </div>
              <div className="text-[11px] text-white/55">
                {portfolio.totalPeakShavingMW.toFixed(1)} MW shaved from 6-9 PM coal peak ·{" "}
                <span className="text-emerald-300">
                  {deployedIds.size} sites · {fmtK(spentBudget)} invested
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string; sub: string; color: "emerald" | "amber" | "sky";
}) {
  const accent = color === "emerald" ? "text-emerald-300" : color === "amber" ? "text-amber-300" : "text-sky-300";
  return (
    <div className="bg-white/[0.04] rounded-xl px-2.5 py-2.5">
      <div className="text-[8.5px] uppercase tracking-wide text-white/40 mb-1" dangerouslySetInnerHTML={{ __html: label }} />
      <div className={`text-[13px] font-medium leading-none ${accent}`}>
        {value}
      </div>
      <div className="text-[8px] text-white/30 mt-1" dangerouslySetInnerHTML={{ __html: sub }} />
    </div>
  );
}
