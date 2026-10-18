"use client";

// HELIOS V2 — the area workspace ("control room"). One full-bleed living map of
// any Singapore planning area, a command bar, a left layer/draw rail and ONE
// tabbed inspector on the right: Plan → Impact → Context → Comply. Same engine
// and panels as V1 HELIO Flow, re-composed so the planner's decision path reads
// left-to-right: see the area → change it → read the impact → check the rules.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye, EyeOff, PersonStanding, Zap, Flame, MapPin, Spline, Hexagon, Check, X, Play, Loader2, Sparkles, FileText,
  Trash2, ShieldCheck, ClipboardList, Activity, Layers, Scale, AlertTriangle, Building2, Terminal, Globe2, Leaf, Unlock, Bot,
} from "lucide-react";
import FlowMap, { type DrawMode } from "@/components/flow/FlowMap";
import CapabilityPanel from "@/components/flow/CapabilityPanel";
import TimelinePanel from "@/components/flow/TimelinePanel";
import DiagnosisPanel, { type BaselineDiagnosis } from "@/components/flow/DiagnosisPanel";
import WorldTimeline from "@/components/flow/WorldTimeline";
import ShockPanel, { shocksFromActive, type ActiveShock } from "@/components/flow/ShockPanel";
import OptimizerPanel from "@/components/flow/OptimizerPanel";
import ReportView from "@/components/flow/ReportView";
import ActPanel from "@/components/flow/ActPanel";
import InterventionParser from "@/components/flow/InterventionParser";
import GlossaryPanel from "@/components/flow/GlossaryPanel";
import AgentsPanel from "@/components/flow/AgentsPanel";
import NewsAlert from "@/components/flow/NewsAlert";
import ScenarioCompare, { type CompareSlot } from "@/components/flow/ScenarioCompare";
import { ComplianceBody } from "@/components/flow/CompliancePanel";
import { Wordmark, AreaSwitcher, Tabs, Label, Stat, ConfChip, Segmented, SimStatus, fmtInt, fmtPct } from "@/components/v2/ui";
import { CURRENCIES, formatMoney, type CurrencyCode } from "@/lib/compass/finance/currency";
import { verdictFor } from "@/lib/compass/finance/verdict";
import { modifierToReportInput } from "@/lib/compass/report/modifierReport";
import type { ReportInput } from "@/lib/compass/report/buildReport";
import type { ModeSplit } from "@/lib/compass/agents";
import { AREAS, areaById, areaView, type Area } from "@/lib/compass/areas";
import type { PickedBuilding } from "@/lib/compass/flow/useIslandWorld";
import SiteInspector from "@/components/v2/SiteInspector";
import IslandPanel from "@/components/v2/IslandPanel";
import { GemmaStatus, AreaResidents } from "@/components/v2/Residents";
import { AreaNature } from "@/components/v2/NaturePanel";
import HazePanel, { AirChip } from "@/components/v2/HazePanel";
import AgentStudio from "@/components/v2/AgentStudio";
import DemoTour, { type DemoStep } from "@/components/v2/DemoTour";
import type { Shock } from "@/lib/compass/world/types";
import Badges from "@/components/v2/Badges";
import { ReplacesStrip } from "@/components/v2/OpenStack";
import { badgesForModifier, carbonValue } from "@/lib/compass/compliance/policy";
import { checkDistrictBuilding, type DistrictBuilding } from "@/lib/compass/compliance/facts";
import {
  simulateScenario, evSiteModifier, fetchSuggestions, PATHWAYS,
  type PathwayId, type WorldModifier, type ModifierGeometry, type ScenarioResult, type EvSite, type OptimizeResult, type EvDisplacementLevel,
} from "@/lib/compass/flow/scenario";

const START_YEAR = 2026;
const TODAY = new Date().toLocaleDateString("en-CA");
const END_YEAR = 2036;

type InspectorTab = "studio" | "island" | "site" | "plan" | "impact" | "context" | "nature" | "comply";

// Opening shot: the whole island, tilted — the city is 3D from the first frame.
const ISLAND_VIEW = { longitude: 103.835, latitude: 1.318, zoom: 11.7, pitch: 58, bearing: -20 };

export default function AreaWorkspace({ areaId: initialAreaId }: { areaId: string | null }) {
  const [areaId, setAreaId] = useState<string | null>(initialAreaId);
  const area = areaId ? areaById(areaId) : undefined;
  const ready = area?.simulation === "ready";
  // Camera: first frame from the route; afterwards the camera flies (no remount).
  const view = useMemo(() => (initialAreaId && areaById(initialAreaId) ? areaView(areaById(initialAreaId)!) : ISLAND_VIEW), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [flyTo, setFlyTo] = useState<any>(null);
  const [site, setSite] = useState<PickedBuilding | null>(null);
  const carShareByArea = useMemo(() => Object.fromEntries(AREAS.map((a) => [a.id, (a.car_share ?? 0.2) + (a.taxi_share ?? 0)])), []);

  const selectArea = (id: string | null, fly = true) => {
    setAreaId(id);
    try {
      window.history.replaceState(null, "", id ? `/sg/${id}` : "/sg");
    } catch {}
    const a = id ? areaById(id) : undefined;
    if (fly) setFlyTo({ ...(a ? areaView(a) : ISLAND_VIEW), key: `${id}-${Date.now()}` });
    if (!id) setTab("island");
  };

  const [boundary, setBoundary] = useState<[number, number][][] | undefined>();
  const [tab, setTab] = useState<InspectorTab>(initialAreaId ? "plan" : "island");
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [pendingGeometry, setPendingGeometry] = useState<ModifierGeometry | null>(null);
  const [modifiers, setModifiers] = useState<WorldModifier[]>([]);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<BaselineDiagnosis | null>(null);
  const [showFlows, setShowFlows] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pathway, setPathway] = useState<PathwayId>("target_achieved");
  const [year, setYear] = useState(START_YEAR);
  const [playing, setPlaying] = useState(false);
  const [agentsOn, setAgentsOn] = useState(true);
  const [pulse, setPulse] = useState(0);
  const [activeShocks, setActiveShocks] = useState<ActiveShock[]>([]);
  const [evSites, setEvSites] = useState<EvSite[]>([]);
  const [showEvSites, setShowEvSites] = useState(false);
  const [showHeat, setShowHeat] = useState(false);
  const [showNature, setShowNature] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optResult, setOptResult] = useState<OptimizeResult | null>(null);
  const [reportTarget, setReportTarget] = useState<{ siteId?: string; intervention?: ReportInput } | null>(null);
  const [actOpen, setActOpen] = useState(false);
  const [slotA, setSlotA] = useState<CompareSlot | null>(null);
  const [slotB, setSlotB] = useState<CompareSlot | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [evDisplacement, setEvDisplacement] = useState<EvDisplacementLevel>("base");
  const [currency, setCurrency] = useState<CurrencyCode>("SGD");

  // Deep link: /sg/<area>?tab=comply opens straight on a tab (demo + sharing).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && ["studio", "island", "plan", "impact", "context", "nature", "comply"].includes(t)) setTab(t as InspectorTab);
    } catch {}
  }, []);

  // Agent Studio plans: if the agents chose another area, fly there and apply once it loads.
  const pendingPlan = useRef<{ area: string; mods: WorldModifier[]; shocks: Shock[] } | null>(null);
  const [studioPrefill, setStudioPrefill] = useState<{ text: string; key: number } | null>(null);
  const shocksToActive = (shocks: Shock[]): ActiveShock[] => shocks.map((s) => ({ presetId: `agent_${s.type}`, startYear: s.startYear, custom: s }));
  const applyAgentPlan = (mods: WorldModifier[], shocks: Shock[]) => {
    const act = shocksToActive(shocks);
    setModifiers(mods);
    setActiveShocks(act);
    runSimulation(mods, pathway, act);
  };

  // BCA buildings in this area, graded against GM2021 for the map markers.
  const [areaBuildings, setAreaBuildings] = useState<DistrictBuilding[]>([]);
  useEffect(() => {
    if (!areaId) {
      setAreaBuildings([]);
      return;
    }
    fetch(`/api/sg/buildings?area=${areaId}`)
      .then((r) => (r.ok ? r.json() : { buildings: [] }))
      .then((d) => setAreaBuildings(d.buildings ?? []))
      .catch(() => {});
  }, [areaId]);
  const markers = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA");
    return areaBuildings
      .filter((b) => b.lat && b.lng)
      .map((b) => {
        const f = checkDistrictBuilding(b, today).findings[0];
        const color: [number, number, number, number] = f.outcome === "fail" ? [248, 113, 113, 235] : f.outcome === "pass" ? [94, 234, 212, 230] : [148, 163, 184, 170];
        return { id: b.id, lng: b.lng!, lat: b.lat!, color, label: `${b.name}\nGM2021: ${f.outcome === "pass" ? f.tier : f.outcome === "fail" ? "below Gold" : "no EUI data"}${b.certificate ? ` · cert ${b.certificate.rating}` : ""}` };
      });
  }, [areaBuildings]);

  // Area boundary outline for the map.
  useEffect(() => {
    if (!areaId) {
      setBoundary(undefined);
      return;
    }
    fetch("/api/sg/areas/boundary?area=" + areaId)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.rings && setBoundary(d.rings))
      .catch(() => {});
  }, [areaId]);

  // Baseline diagnosis + policy-only run (only where the simulation has been built).
  useEffect(() => {
    setResult(null);
    setDiagnosis(null);
    setModifiers([]);
    setOptResult(null);
    if (!areaId) return;
    if (!ready) {
      setTab((t) => (t === "plan" || t === "impact" ? "context" : t));
      return;
    }
    fetch(`/api/compass/world/baseline?area=${areaId}`)
      .then((r) => r.json())
      .then((d) => !d.error && setDiagnosis(d))
      .catch(() => {});
    fetch(`/api/compass/ev/candidates?area=${areaId}`)
      .then((r) => r.json())
      .then((d) => !d.error && setEvSites(d.sites ?? []))
      .catch(() => {});
    const p = pendingPlan.current;
    if (p && p.area === areaId) {
      pendingPlan.current = null;
      const act = shocksToActive(p.shocks);
      setModifiers(p.mods);
      setActiveShocks(act);
      setRunning(true);
      simulateScenario(p.mods, START_YEAR, END_YEAR, pathway, shocksFromActive(act), evDisplacement, areaId)
        .then(setResult)
        .catch((e) => setErr(e?.message ?? String(e)))
        .finally(() => setRunning(false));
      return;
    }
    simulateScenario([], START_YEAR, END_YEAR, "target_achieved", [], "base", areaId).then(setResult).catch(() => {});
  }, [areaId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const yearIdx = Math.max(0, Math.min(year - START_YEAR, (result?.timeline.length ?? 1) - 1));
  const shareForYear: ModeSplit | null =
    (result?.timeline[yearIdx]?.modeShare as ModeSplit | undefined) ?? (diagnosis ? (diagnosis.modeShare as unknown as ModeSplit) : null);
  const verdictBad = result ? verdictFor(result.summary.costPerTonneUsd).tone === "bad" : false;

  const runSimulation = async (
    mods: WorldModifier[],
    pw: PathwayId = pathway,
    shockList: ActiveShock[] = activeShocks,
    evd: EvDisplacementLevel = evDisplacement
  ) => {
    if (!ready || !areaId) return;
    setRunning(true);
    setErr(null);
    try {
      const r = await simulateScenario(mods, START_YEAR, END_YEAR, pw, shocksFromActive(shockList), evd, areaId!);
      setResult(r);
      if (mods.length) setTab("impact");
      if (verdictFor(r.summary.costPerTonneUsd).tone !== "bad") setPulse((p) => p + 1);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  };

  const addModifiers = (mods: WorldModifier[]) => {
    const fresh = mods.filter((m) => !modifiers.some((x) => x.id === m.id));
    if (!fresh.length) return;
    const next = [...modifiers, ...fresh];
    setModifiers(next);
    runSimulation(next);
  };

  const runOptimizer = async () => {
    setOptimizing(true);
    setErr(null);
    try {
      setOptResult(
        await fetchSuggestions({ budgetUsd: 2_000_000, policyPathway: pathway, shocks: shocksFromActive(activeShocks), existingModifierIds: modifiers.map((m) => m.id), districtId: areaId ?? undefined })
      );
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setOptimizing(false);
    }
  };

  const canFinish = (drawMode === "line" && draft.length >= 2) || (drawMode === "polygon" && draft.length >= 3);
  const finishGeometry = (g: ModifierGeometry) => {
    setPendingGeometry(g);
    setDrawMode(null);
  };
  const finishNow = () => {
    if (!canFinish) return;
    if (drawMode === "line") finishGeometry({ type: "LineString", coordinates: draft });
    else finishGeometry({ type: "Polygon", coordinates: [[...draft, draft[0]]] });
    setDraft([]);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawMode(null);
        setDraft([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // KPIs describe YOUR plan — blank until there is one (the policy-only run is the baseline).
  const s = modifiers.length ? result?.summary : undefined;
  const verdict = s ? verdictFor(s.costPerTonneUsd) : null;

  // The Singapore demo drives the real app: camera, tabs, layers and the haze injection.
  const sgDemo: DemoStep[] = [
    {
      title: "One living island",
      body: "All of Singapore in 3D: <b>123,714 buildings</b>, every MRT line, cars and buses on the real road network. Every number in HELIOS traces to an open government or science source.",
      before: () => {
        setSite(null);
        selectArea(null);
      },
      wait: 1800,
    },
    {
      element: '[data-tour="air"]',
      title: "Today's air, live",
      body: "Singapore is in a transboundary haze episode right now. HELIOS reads NEA's real-time PSI and turns it into physics the simulation uses: fewer people walk and cycle, rooftop solar dips.",
    },
    {
      element: '[data-tour="studio"]',
      title: "Tell the agents an idea",
      body: "Six Google ADK agents take a sentence and do the work: the <b>designer</b> picks costed changes, the <b>analyst</b> simulates 2026–2036, <b>compliance</b> checks Singapore's rules, <b>sites</b> screens nature and flood, the <b>red team</b> argues against it. Every number is checked against a tool result.",
      before: () => setTab("studio"),
      wait: 400,
    },
    {
      element: '[data-tour="nature"]',
      title: "Nature and flood risk for every building",
      body: "Flying to Tampines. Each area gets TNFD-style screening: nature reserves, coastal habitat, ground level against PUB's 4 m rule, PUB flood-prone streets and GBIF species records.",
      before: () => {
        selectArea("tampines");
        setTab("nature");
        setShowNature(true);
      },
      wait: 3000,
    },
    {
      element: '[data-tour="haze"]',
      title: "Test the plan against today's haze",
      body: "One click injects today's measured haze into the 10-year simulation. Shelters don't help here, because it's the air: trips move to MRT, bus and car, and the plan's carbon and cost per tonne change.",
      before: () => setTab("context"),
      wait: 900,
    },
    {
      element: '[data-tour="draw"]',
      title: "Change the city",
      body: "Draw a point, corridor or zone, or ask HELIOS to suggest a package under a budget. Simulated residents on real LTA fare-card corridors re-choose how they travel.",
      before: () => setTab("plan"),
      wait: 400,
    },
    {
      element: '[data-tour="comply"]',
      title: "Rules, carbon and what-ifs",
      body: "Green Mark, the Singapore-Asia Taxonomy, the Carbon Pricing Act and the EV Charging Act as cited, tested rules. Draft a Scope 1 & 2 disclosure, or see what flips at S$80 a tonne.",
      before: () => setTab("comply"),
      wait: 700,
    },
    {
      element: '[data-tour="clock"]',
      title: "2026 → 2036",
      body: "Press play to watch the plan come online year by year, under the Green Plan pathway and any shocks you've injected.",
    },
    {
      title: "Built to be checked",
      body: "Open <b>Rules</b> to watch a local model draft rules from the law with page-verified quotes, or <b>Evidence</b> for validation and every source. 180 automated checks run on every change.",
    },
  ];

  // Film mode (/sg?film=1): full-bleed 3D only, with hooks for the capture script.
  const [film, setFilm] = useState(false);
  useEffect(() => {
    try {
      setFilm(new URLSearchParams(window.location.search).has("film"));
    } catch {}
  }, []);
  useEffect(() => {
    if (!film) return;
    (window as any).__heliosFilm = {
      area: (id: string | null) => selectArea(id, false),
      plan: async (area: string, ids: string[]) => {
        const r = await fetch("/api/studio/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "get_modifiers", args: { area, change_ids: ids } }) });
        const d = await r.json();
        if (d.ok) setModifiers(d.result.modifiers);
      },
      heat: setShowHeat,
      nature: setShowNature,
      flows: setShowFlows,
      agents: setAgentsOn,
      evSites: setShowEvSites,
      pulse: () => setPulse((p) => p + 1),
      year: setYear,
    };
  });

  const layers = [
    { on: showFlows, set: () => setShowFlows(!showFlows), icon: showFlows ? Eye : EyeOff, title: "Baseline flows — real fare-card OD" },
    { on: agentsOn, set: () => setAgentsOn(!agentsOn), icon: PersonStanding, title: "Living agents on real corridors" },
    { on: showHeat, set: () => setShowHeat(!showHeat), icon: Flame, title: "Effective heat exposure per corridor" },
    { on: showEvSites, set: () => setShowEvSites(!showEvSites), icon: Zap, title: "HELIO-recommended EV charging zones (click to accept)" },
    { on: showNature, set: () => setShowNature(!showNature), icon: Leaf, title: "Nature & flood: reserves, nature areas, coastal habitat, PUB flood-prone spots, heritage trees" },
  ];
  const tools: { mode: DrawMode; icon: any; label: string }[] = [
    { mode: "point", icon: MapPin, label: "Point" },
    { mode: "line", icon: Spline, label: "Corridor" },
    { mode: "polygon", icon: Hexagon, label: "Zone" },
  ];


  if (film)
    return (
      <main className="v2 relative h-screen w-screen overflow-hidden">
        <FlowMap
          areaId={areaId ?? "island"}
          initialView={view}
          island
          flyTo={null}
          carShareByArea={carShareByArea}
          simulationReady={ready}
          boundary={boundary}
          markers={[]}
          drawMode={null}
          draft={[]}
          onDraftChange={() => {}}
          onFinish={() => {}}
          modifiers={modifiers}
          showFlows={showFlows}
          detected={diagnosis?.detected ?? []}
          highlightId={null}
          year={year}
          modeShare={shareForYear}
          agentsOn={agentsOn && ready}
          demandFactor={1}
          pulse={pulse}
          evSites={showEvSites ? evSites : []}
          onEvSiteClick={() => {}}
          showHeat={showHeat}
          showNature={showNature}
        />
      </main>
    );

  return (
    <main className="v2 relative h-screen w-screen overflow-hidden">
      {/* ── Map (full bleed, under the command bar) ───────────────────── */}
      <div className="absolute inset-0 top-12">
        <FlowMap
          areaId={areaId ?? "island"}
          initialView={view}
          island
          flyTo={flyTo}
          carShareByArea={carShareByArea}
          simulationReady={ready}
          pickedBuilding={site}
          onPickBuilding={(b) => {
            if (drawMode) return;
            setSite(b);
            setTab("site");
            if (b.areaId !== areaId) selectArea(b.areaId, false);
          }}
          boundary={boundary}
          markers={tab === "comply" ? markers : []}
          drawMode={drawMode}
          draft={draft}
          onDraftChange={setDraft}
          onFinish={finishGeometry}
          modifiers={modifiers}
          showFlows={showFlows}
          detected={diagnosis?.detected ?? []}
          highlightId={highlightId}
          year={year}
          modeShare={shareForYear}
          agentsOn={agentsOn && ready}
          demandFactor={result?.timeline[yearIdx]?.demandFactor ?? 1}
          pulse={pulse}
          evSites={showEvSites ? evSites : []}
          onEvSiteClick={(site) => addModifiers([evSiteModifier(site, year)])}
          showHeat={showHeat}
          showNature={showNature}
        />
      </div>

      {/* ── Command bar ───────────────────────────────────────────────── */}
      <header className="absolute top-0 inset-x-0 h-12 z-50 flex items-center gap-3 px-3 border-b border-line bg-ink-0/90 backdrop-blur">
        <Wordmark />
        <span className="h-5 w-px bg-line" />
        <AreaSwitcher current={area} onPick={(a) => selectArea(a.id)} />
        {area ? <span className="hidden lg:inline-flex whitespace-nowrap"><SimStatus area={area} /></span> : <span className="mono text-[9.5px] uppercase tracking-wider text-white/40 whitespace-nowrap hidden lg:inline">island world · 124k buildings</span>}
        {area && (
          <button onClick={() => { setSite(null); selectArea(null); }} className="v2-btn !h-7 hidden lg:inline-flex whitespace-nowrap" title="Back to the whole island">
            Whole island
          </button>
        )}
        <div className="flex-1" />
        <AirChip city="singapore" onClick={() => setTab(area ? "context" : "island")} />
        <GemmaStatus />
        <div className="hidden lg:flex items-center gap-2" data-tour="layers">
          <Label className="hidden 2xl:block">Pathway</Label>
          <select
            value={pathway}
            onChange={(e) => {
              const pw = e.target.value as PathwayId;
              setPathway(pw);
              runSimulation(modifiers, pw);
            }}
            className="mono h-7 rounded-[4px] border border-line bg-ink-1 px-2 text-[11px] text-white/80"
            title={PATHWAYS.find((p) => p.id === pathway)?.hint}
          >
            {PATHWAYS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <Segmented<CurrencyCode> size="xs" options={CURRENCIES.map((c) => ({ id: c, label: c }))} value={currency} onChange={setCurrency} />
        <span className="h-5 w-px bg-line hidden md:block" />
        <div className="hidden md:flex items-center gap-1.5">
          <a href="/sg/open" className="v2-btn" title="What HELIOS replaces, and every open source it is built from">
            <Unlock size={13} className="text-signal-300" /> Open stack
          </a>
          <a href="/sg/rules" className="v2-btn" title="Draft compliance rules from policy documents with local Gemma">
            <Scale size={13} className="text-signal-300" /> Rules
          </a>
          <a href="/helio-flow/evidence" className="v2-btn" title="Validation, sensitivity and sources">
            <ShieldCheck size={13} className="text-signal-300" /> Evidence
          </a>
          <GlossaryPanel inline />
          <AgentsPanel inline />
          <DemoTour label="Singapore demo" storageKey="helios-sg-demo" steps={sgDemo} />
          {ready && (
            <NewsAlert
              inline
              onApply={(presetId, y) => {
                if (!activeShocks.some((a) => a.presetId === presetId)) {
                  const next = [...activeShocks, { presetId, startYear: y }];
                  setActiveShocks(next);
                  runSimulation(modifiers, pathway, next);
                }
              }}
            />
          )}
        </div>
      </header>

      {/* ── Left rail: layers + draw ──────────────────────────────────── */}
      <div className="absolute top-16 left-3 z-40 flex flex-col gap-2">
        <div className="v2-panel flex flex-col p-1 gap-0.5">
          {layers.map((l, i) => {
            const Icon = l.icon;
            return (
              <button key={i} onClick={l.set} title={l.title} className={`h-8 w-8 flex items-center justify-center rounded-[4px] transition-colors ${l.on ? "text-signal-300 bg-signal-300/10" : "text-white/40 hover:text-white"}`}>
                <Icon size={15} />
              </button>
            );
          })}
        </div>
        <div className="v2-panel flex flex-col p-1 gap-0.5" data-tour="draw">
          {tools.map(({ mode, icon: Icon, label }) => (
            <button
              key={label}
              disabled={!ready}
              title={ready ? `Draw a ${label.toLowerCase()}` : "Simulation not built for this area yet"}
              onClick={() => {
                setDraft([]);
                setDrawMode(drawMode === mode ? null : mode);
              }}
              className={`h-8 w-8 flex items-center justify-center rounded-[4px] transition-colors disabled:opacity-25 ${drawMode === mode ? "text-warn-400 bg-warn-400/10" : "text-white/40 hover:text-white"}`}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {/* Draw hint */}
      {drawMode && (
        <div className="absolute top-16 left-16 z-40 v2-panel flex items-center gap-2 px-3 h-9 text-[11.5px] text-white/70">
          <span className="v2-led text-warn-400" />
          {drawMode === "point"
            ? "Click the map to place a point"
            : draft.length === 0
              ? `Click to start the ${drawMode === "line" ? "corridor" : "zone"}`
              : `${draft.length} pts · ${canFinish ? "double-click or Finish" : `need ${drawMode === "line" ? 2 : 3}+`} · Esc cancels`}
          {canFinish && (
            <button onClick={finishNow} className="v2-btn-primary !h-7">
              <Check size={12} /> Finish
            </button>
          )}
          <button onClick={() => { setDrawMode(null); setDraft([]); }} className="text-white/40 hover:text-white">
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Area card (bottom-left) ───────────────────────────────────── */}
      {area ? (
      <div className="absolute bottom-4 left-3 z-30 v2-panel v2-ticks w-[270px] p-3 hidden md:block">
        <div className="flex items-center justify-between">
          <Label>{area.region}</Label>
          <ConfChip conf="measured" />
        </div>
        <div className="text-[15px] text-white mt-1">{area.name}</div>
        <div className="grid grid-cols-3 gap-2 mt-2.5">
          <Stat label="Residents" value={area.population ? `${(area.population / 1000).toFixed(0)}k` : "—"} />
          <Stat label="Transit to work" value={fmtPct(area.pt_share)} tone="signal" />
          <Stat label="Car to work" value={fmtPct(area.car_share)} tone="warn" />
        </div>
        <div className="mt-2 text-[10px] text-white/35 leading-snug">
          65+ {fmtPct(area.share_65_plus)} · HDB {fmtPct(area.share_hdb)} · {area.bus_stops} bus stops · {area.stations} stations · Census GHS 2025
        </div>
      </div>
      ) : (
        <div className="absolute bottom-4 left-3 z-30 v2-panel v2-ticks w-[300px] p-3 hidden md:block">
          <Label>Singapore · living world</Label>
          <div className="text-[15px] text-white mt-1">124k buildings · 5,205 stops · 187 stations</div>
          <div className="mt-2 grid gap-1 text-[10.5px] text-white/50">
            <span className="flex items-center gap-2"><span className="v2-led" style={{ color: "#f87171", width: 5, height: 5 }} /> Cars &amp; <span className="v2-led" style={{ color: "#5eead4", width: 5, height: 5 }} /> buses on the real road network</span>
            <span className="flex items-center gap-2"><span className="v2-led" style={{ color: "#a7f3e4", width: 5, height: 5 }} /> People &amp; <span className="v2-led" style={{ color: "#c4b5fd", width: 5, height: 5 }} /> cyclists on footpaths (zoom in)</span>
            <span className="flex items-center gap-2"><span className="v2-led" style={{ color: "#f5b83d", width: 5, height: 5 }} /> Trains on every MRT / LRT line</span>
          </div>
          <div className="mt-2 text-[10px] text-white/35 leading-snug">Buildings: OSM footprints + HDB storeys. Ambient traffic density follows each area's census car share (visual, not a forecast). The calibrated agent simulation runs where an area's LTA world is built.</div>
        </div>
      )}

      {/* ── Inspector ─────────────────────────────────────────────────── */}
      <aside data-tour="decide" className="absolute top-12 right-0 bottom-0 z-40 w-[400px] max-w-[92vw] flex flex-col border-l border-line bg-ink-1/[0.94] backdrop-blur">
        {/* KPI strip — the three impact metrics, always visible in an area */}
        <div className={`grid grid-cols-3 gap-3 px-4 py-3 border-b border-line ${area ? "" : "hidden"}`}>
          <Stat label="CO₂ avoided · 10y" value={s ? fmtInt(s.cumulativeCO2AvoidedTonnes) : "—"} unit="t" tone="signal" />
          <Stat label="Cost / tonne" value={s?.costPerTonneUsd ? formatMoney(s.costPerTonneUsd, currency) : "—"} tone={verdict?.tone === "bad" ? "risk" : verdict?.tone === "warn" ? "warn" : "default"} />
          <Stat label="Heat exposure" value={s ? `−${s.heatExposureReducedPct.toFixed(1)}%` : "—"} />
        </div>
        <Tabs<InspectorTab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "studio" as InspectorTab, label: "Agents", icon: Bot },
            ...(!area ? [{ id: "island" as InspectorTab, label: "Singapore", icon: Globe2 }] : []),
            ...(site ? [{ id: "site" as InspectorTab, label: "Building", icon: Building2 }] : []),
            ...(area
              ? [
                  { id: "plan" as InspectorTab, label: "Plan", icon: ClipboardList, badge: modifiers.length ? <span className="mono text-[9.5px] text-warn-400">{modifiers.length}</span> : null },
                  { id: "impact" as InspectorTab, label: "Impact", icon: Activity },
                  { id: "context" as InspectorTab, label: "Context", icon: Layers },
                  { id: "nature" as InspectorTab, label: "Nature", icon: Leaf },
                  { id: "comply" as InspectorTab, label: "Comply", icon: Scale },
                ]
              : []),
          ]}
        />
        <div className="flex-1 overflow-y-auto v2-scroll px-4 py-3 v2-embed">
          <div className={tab === "studio" ? "" : "hidden"}>
            <AgentStudio
              areaName={area?.name}
              prefill={studioPrefill}
              onPlan={(planArea, mods, shocks) => {
                if (planArea !== areaId) {
                  pendingPlan.current = { area: planArea, mods, shocks };
                  selectArea(planArea);
                } else applyAgentPlan(mods, shocks);
              }}
            />
          </div>
          {tab === "island" && !area && <IslandPanel onPick={(a) => selectArea(a.id)} />}
          {tab === "site" && site && (
            <SiteInspector
              site={site}
              areaName={areaById(site.areaId)?.name ?? "Singapore"}
              bcaBuildings={areaBuildings}
              currency={currency}
              canSimulate={ready}
              onAddToWorld={(m) => {
                if (ready) addModifiers([m]);
                else setModifiers((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
              }}
            />
          )}
          {area && tab === "plan" && (
            ready ? (
              <div className="space-y-4">
                <div>
                  <Label className="mb-2">Describe a change</Label>
                  <InterventionParser placeIndex={modifiers.length} onAdd={(m) => addModifiers([m])} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Changes in the world</Label>
                    <span className="mono text-[10px] text-white/35">{modifiers.length}</span>
                  </div>
                  {modifiers.length === 0 ? (
                    <div className="text-[11.5px] text-white/40 leading-snug border border-dashed border-line rounded-[4px] p-3">
                      Draw a point, corridor or zone from the left rail, describe one above, or let HELIOS suggest a package. Agents on real LTA corridors react to every change.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {modifiers.map((m) => (
                        <div key={m.id} className="flex items-center justify-between rounded-[4px] border border-line px-2.5 py-1.5">
                          <div className="min-w-0">
                            <div className="text-[12px] text-white/85 truncate">{m.label}</div>
                            <div className="mono text-[10px] text-white/35">
                              {m.geometry.type} · {m.metadata.builtYear} · {formatMoney(m.economics.capexUsd, currency)}
                            </div>
                            <Badges className="mt-1" badges={badgesForModifier(m, { asOf: TODAY, host: areaBuildings.find((b) => b.id === m.metadata.hostBuildingId) ?? null })} />
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              title="Feasibility report"
                              onClick={() => setReportTarget(m.id.startsWith("mod_ev_") ? { siteId: m.id.replace("mod_ev_", "") } : { intervention: modifierToReportInput(m) })}
                              className="text-white/30 hover:text-signal-300"
                            >
                              <FileText size={13} />
                            </button>
                            <button
                              title="Remove"
                              onClick={() => {
                                const next = modifiers.filter((x) => x.id !== m.id);
                                setModifiers(next);
                                runSimulation(next);
                              }}
                              className="text-white/30 hover:text-risk-400"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid gap-2">
                  <button disabled={running} onClick={() => runSimulation(modifiers)} className="v2-btn-primary w-full">
                    {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    {running ? "Agents reacting…" : modifiers.length ? `Simulate ${START_YEAR}–${END_YEAR}` : "Watch the area evolve"}
                  </button>
                  <button disabled={optimizing} onClick={runOptimizer} className="v2-btn w-full justify-center">
                    {optimizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-signal-300" />}
                    {optimizing ? "Scoring candidates…" : "Suggest a package (S$2.7M / US$2M budget)"}
                  </button>
                  {result && modifiers.length > 0 && (
                    <button onClick={() => setActOpen(true)} className="v2-btn w-full justify-center text-white">
                      <FileText size={13} /> Turn into an action plan →
                    </button>
                  )}
                  {result && (
                    <div className="flex gap-2">
                      <button onClick={() => setSlotA({ label: modifiers.length ? `${modifiers.length} changes` : "Policy only", count: modifiers.length, result })} className="v2-btn flex-1 justify-center" data-active={!!slotA}>
                        {slotA ? `A ✓ (${slotA.count})` : "Save as A"}
                      </button>
                      <button onClick={() => setSlotB({ label: modifiers.length ? `${modifiers.length} changes` : "Policy only", count: modifiers.length, result })} className="v2-btn flex-1 justify-center" data-active={!!slotB}>
                        {slotB ? `B ✓ (${slotB.count})` : "Save as B"}
                      </button>
                      {slotA && slotB && (
                        <button onClick={() => setCompareOpen(true)} className="v2-btn">Compare</button>
                      )}
                    </div>
                  )}
                </div>
                {optResult && (
                  <OptimizerPanel result={optResult} acceptedIds={new Set(modifiers.map((m) => m.id))} onAccept={addModifiers} onClose={() => setOptResult(null)} />
                )}
              </div>
            ) : (
              <NotBuilt area={area} />
            )
          )}

          {area && tab === "impact" &&
            (result ? (
              <>
                <ReplacesStrip id="mobility_model" className="mb-3" />
                <TimelinePanel result={result} yearIdx={yearIdx} currency={currency} />
                {modifiers.length > 0 && <CarbonValueStrip result={result} onOpen={() => setTab("comply")} />}
                {modifiers.length > 0 && (
                  <AreaResidents
                    planKey={`${area.id}|${pathway}|${modifiers.map((m) => m.id).join(",")}`}
                    body={{
                      areaId: area.id,
                      areaName: area.name,
                      changes: modifiers.map((m) => m.label),
                      summary: result.summary,
                      carShareBaseline: result.baselineTimeline[result.baselineTimeline.length - 1]?.modeShare.car,
                    }}
                  />
                )}
                {modifiers.length > 0 && <ReplacesStrip id="resident_panels" className="mt-3" />}
              </>
            ) : ready ? (
              <Loading />
            ) : (
              <NotBuilt area={area} />
            ))}

          {area && tab === "context" && (
            <div className="space-y-4">
              <HazePanel
                city="singapore"
                startYear={START_YEAR}
                injected={activeShocks.some((a) => a.presetId === "haze_live")}
                onInject={
                  ready
                    ? (shock) => {
                        const next = [...activeShocks.filter((a) => a.presetId !== "haze_live"), { presetId: "haze_live", startYear: START_YEAR, custom: shock }];
                        setActiveShocks(next);
                        runSimulation(modifiers, pathway, next);
                      }
                    : undefined
                }
              />
              {ready && <div>
                <Label className="mb-2">Shocks · resilience test</Label>
                <ShockPanel
                  active={activeShocks}
                  onChange={(next) => {
                    setActiveShocks(next);
                    runSimulation(modifiers, pathway, next);
                  }}
                  startYear={START_YEAR}
                  endYear={END_YEAR}
                />
              </div>}
              {(showEvSites || modifiers.some((m) => m.effects.chargingCapacityKWDelta)) && (
                <div>
                  <Label className="mb-2">EV displacement · how much charging replaces ICE</Label>
                  <Segmented
                    options={[
                      { id: "conservative", label: "Cons. 20%" },
                      { id: "base", label: "Base 50%" },
                      { id: "aggressive", label: "Aggr. 80%" },
                    ]}
                    value={evDisplacement}
                    onChange={(v) => {
                      setEvDisplacement(v as EvDisplacementLevel);
                      runSimulation(modifiers, pathway, activeShocks, v as EvDisplacementLevel);
                    }}
                  />
                </div>
              )}
              {diagnosis ? (
                <div>
                  <Label className="mb-2">Baseline diagnosis</Label>
                  <DiagnosisPanel diagnosis={diagnosis} onHoverCorridor={setHighlightId} />
                </div>
              ) : !ready ? (
                <CensusDetail area={area} />
              ) : (
                <Loading />
              )}
            </div>
          )}

          {area && tab === "nature" && <AreaNature areaId={area.id} areaName={area.name} showLayer={showNature} onToggleLayer={() => setShowNature(!showNature)} />}

          {area && tab === "comply" && <ComplianceBody areaId={area.id} areaName={area.name} result={modifiers.length ? result : null} planCount={modifiers.length} />}
        </div>
      </aside>

      {/* ── Master clock ──────────────────────────────────────────────── */}
      {ready && (
        <div data-tour="clock" className="absolute bottom-4 z-40 left-1/2 -translate-x-1/2 md:left-[calc(50%-200px+135px)] max-w-[calc(100vw-440px)]">
          <WorldTimeline
            startYear={START_YEAR}
            endYear={END_YEAR}
            year={year}
            onYearChange={setYear}
            playing={playing}
            onPlayingChange={(p) => {
              setPlaying(p);
              if (p && agentsOn && !verdictBad) setPulse((x) => x + 1);
            }}
            result={result}
            modifiers={modifiers}
            shocks={shocksFromActive(activeShocks)}
          />
        </div>
      )}

      {/* Placement check */}
      {result?.placementWarnings && result.placementWarnings.length > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 v2-panel px-3 py-2 max-w-[420px] border-warn-400/30">
          <div className="flex items-center gap-1.5 text-[11px] text-warn-400 mb-1">
            <AlertTriangle size={12} /> Placement check — verify before committing
          </div>
          {result.placementWarnings.slice(0, 3).map((w) => (
            <div key={w.modifierId} className="text-[10.5px] text-white/70 leading-snug">
              <span className="text-white/85">{w.label}</span> — {w.flags[0].message} <span className="text-white/45">Fix: {w.flags[0].fix}</span>
            </div>
          ))}
        </div>
      )}

      {err && <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 v2-panel px-4 py-2 text-xs text-risk-300">{err}</div>}

      {reportTarget && <ReportView siteId={reportTarget.siteId} intervention={reportTarget.intervention} onClose={() => setReportTarget(null)} />}
      {actOpen && result && (
        <ActPanel result={result} modifiers={modifiers} currency={currency} shocks={shocksFromActive(activeShocks)} optResult={optResult} onClose={() => setActOpen(false)} />
      )}
      {compareOpen && slotA && slotB && <ScenarioCompare a={slotA} b={slotB} currency={currency} onClose={() => setCompareOpen(false)} />}
      {pendingGeometry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPendingGeometry(null)}>
          <div className="max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <CapabilityPanel
              geometry={pendingGeometry}
              startYear={START_YEAR}
              endYear={END_YEAR}
              currency={currency}
              onConfirm={(m) => {
                setPendingGeometry(null);
                addModifiers([m]);
              }}
              onCancel={() => setPendingGeometry(null)}
            />
          </div>
        </div>
      )}
    </main>
  );
}

/** Cost per tonne net of carbon value, at the law vs the top of the 2030 range. */
function CarbonValueStrip({ result, onOpen }: { result: ScenarioResult; onOpen: () => void }) {
  const rows = carbonValue(result);
  const law = rows.find((r) => r.scenario === "law")!;
  const high = rows.find((r) => r.scenario === "high")!;
  const s = (n: number | null) => (n == null ? "—" : `S$${Math.round(n).toLocaleString("en-SG")}/t`);
  return (
    <div className="mt-3 rounded-[4px] border border-line p-2.5 text-[11px]">
      <div className="flex items-center justify-between">
        <Label>Net of carbon value</Label>
        <button onClick={onOpen} className="text-[10.5px] text-signal-300 hover:text-signal-200">What-if →</button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1.5">
        <div>
          <div className="text-white/45">Law (S$45/t)</div>
          <div className={`mono ${law.flips ? "text-signal-300" : "text-white/85"}`}>{s(law.netCostPerTonneSgd)}</div>
        </div>
        <div>
          <div className="text-white/45">S$80/t by 2030 (proposed)</div>
          <div className={`mono ${high.flips ? "text-signal-300" : "text-warn-300"}`}>{s(high.netCostPerTonneSgd)}</div>
        </div>
      </div>
      <div className="text-[10px] text-white/35 mt-1">{high.flips ? "At S$80/t this plan pays for itself on carbon alone." : "No carbon price in the stated range makes this plan pay for itself on carbon alone."}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 justify-center text-[11.5px] text-white/40">
      <Loader2 size={13} className="animate-spin" /> Running the area…
    </div>
  );
}

function NotBuilt({ area }: { area: Area }) {
  return (
    <div className="space-y-3">
      <div className="rounded-[4px] border border-warn-400/30 bg-warn-400/[0.06] p-3">
        <div className="flex items-center gap-1.5 text-[12px] text-warn-300">
          <Terminal size={13} /> Simulation not built for {area.name} yet
        </div>
        <p className="text-[11.5px] text-white/60 mt-1.5 leading-snug">
          The 3D city, census profile and building compliance are live. The agent simulation needs one month of LTA fare-card data for this area. One command builds every area:
        </p>
        <pre className="mono mt-2 rounded-[3px] bg-ink-0 border border-line p-2 text-[10.5px] text-signal-200 whitespace-pre-wrap">python ingest/fetch_lta_national.py{"\n"}python ingest/build_area.py all</pre>
      </div>
      <div className="text-[11px] text-white/45 leading-snug flex items-start gap-1.5">
        <Building2 size={12} className="mt-0.5 shrink-0" /> Check the <b className="font-medium text-white/70">Comply</b> tab: BCA's measured energy data and Green Mark certificates already cover every listed building here.
      </div>
    </div>
  );
}

function CensusDetail({ area }: { area: Area }) {
  const rows: [string, string][] = [
    ["Residents", fmtInt(area.population)],
    ["Households", fmtInt(area.households)],
    ["Commuters (work)", fmtInt(area.commuters)],
    ["Transit to work", fmtPct(area.pt_share, 1)],
    ["Car to work", fmtPct(area.car_share, 1)],
    ["Taxi / private hire", fmtPct(area.taxi_share, 1)],
    ["Aged 65+", fmtPct(area.share_65_plus, 1)],
    ["Under 15", fmtPct(area.share_under_15, 1)],
    ["HDB · condo · landed", `${fmtPct(area.share_hdb)} · ${fmtPct(area.share_condo)} · ${fmtPct(area.share_landed)}`],
    ["Household income ≥ S$10k", fmtPct(area.share_hh_income_10k_plus)],
    ["Household income < S$3k", fmtPct(area.share_hh_income_below_3k)],
    ["Bus stops · stations", `${area.bus_stops} · ${area.stations}`],
    ["Land area", `${area.area_km2} km²`],
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label>Area profile</Label>
        <ConfChip conf="measured" />
      </div>
      <table className="w-full text-[11.5px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-line/60">
              <td className="py-1.5 text-white/50">{k}</td>
              <td className="py-1.5 text-right mono text-white/85">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-white/35 mt-2">SingStat General Household Survey 2025 · URA MP2019 · LTA via data.gov.sg</div>
    </div>
  );
}
