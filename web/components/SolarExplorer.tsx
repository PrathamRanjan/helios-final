"use client";

// The rooftop / solar pre-feasibility experience (formerly the root page).
// Now a reusable surface: /bangkok mounts it defaulted to Thailand, where the
// Google Solar API has real coverage. Click any rooftop → 60-second solar report.

import { useEffect, useState } from "react";
import Map3D, { type MapTarget, type LatLng } from "@/components/Map3D";
import Hero from "@/components/Hero";
import Sidebar from "@/components/Sidebar";
import SearchBar from "@/components/SearchBar";
import CountryToggle from "@/components/CountryToggle";
import DrawToolbar from "@/components/DrawToolbar";
import {
  fetchDemo,
  fetchDemoList,
  fetchSolar,
  fetchSolarManual,
} from "@/lib/client-api";
import {
  COUNTRIES,
  type CountryCode,
  type DemoListItem,
  type SolarData,
} from "@/types";
import { Sun, Globe } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { loadGoogleMaps } from "@/lib/google-maps";
import CityRail from "@/components/city/CityRail";
import DemoTour, { type DemoStep } from "@/components/v2/DemoTour";
import HazePanel from "@/components/v2/HazePanel";

// Bangkok demo: measured rooftop solar, draw-your-own roof, and the PM2.5 season that dims panels.
function bangkokDemo(pickDemo: () => Promise<void>, showAir: (v: boolean) => void): DemoStep[] {
  return [
    {
      title: "Bangkok: rooftop solar, measured",
      body: "Thailand is one of the few ASEAN countries where Google's Solar API has <b>real per-building roof data</b>. HELIOS turns any roof into a system size, yield, payback in baht and CO₂ avoided.",
    },
    {
      element: '[data-tour="solar-sidebar"]',
      title: "One click, one feasibility study",
      body: "Flying to a real Bangkok building. Panels, roof segments and sunshine hours come from the Solar API; the finance uses Thai tariffs. Each figure is labelled measured or estimated.",
      before: async () => {
        showAir(false);
        await pickDemo();
      },
      wait: 3500,
    },
    {
      element: '[data-tour="draw-roof"]',
      title: "No data? Draw the roof",
      body: "Where the API has no coverage, trace the roof yourself. HELIOS computes the area and runs the same model, clearly labelled as user-drawn.",
    },
    {
      element: '[data-tour="air-card"]',
      title: "Bangkok's air dims the panels",
      body: "Live PM2.5 for Bangkok (Copernicus CAMS model). In the burning season, smoke cuts solar yield on hazy days. HELIOS uses the same haze physics as Singapore, so a solar business case can be stress-tested against bad-air months.",
      before: () => showAir(true),
      wait: 1200,
    },
    {
      title: "Same engine, three cities",
      body: "Singapore runs the full city simulation with agents and compliance; Bangkok shows rooftop solar at building scale; India adds urban cooling and water. Use the city rail to switch.",
      before: () => showAir(false),
    },
  ];
}

export default function SolarExplorer({ initialCountry = "TH" }: { initialCountry?: CountryCode }) {
  const [country, setCountry] = useState<CountryCode>(initialCountry);
  const [target, setTarget] = useState<MapTarget | null>(null);
  const [solar, setSolar] = useState<SolarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [demos, setDemos] = useState<DemoListItem[]>([]);
  const [demoSlug, setDemoSlug] = useState<string | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);

  // Tier C drawing state
  const [drawingMode, setDrawingMode] = useState(false);
  const [polygonPath, setPolygonPath] = useState<LatLng[]>([]);
  const [polygonArea, setPolygonArea] = useState(0);
  const [drawRoofType, setDrawRoofType] = useState("flat");
  const [drawSubmitting, setDrawSubmitting] = useState(false);

  const countryProfile = COUNTRIES.find((c) => c.code === country)!;
  const [showAir, setShowAir] = useState(false);
  const pickFirstDemo = async () => {
    const list = demos.length ? demos : await fetchDemoList(country).catch(() => []);
    if (list[0]) await handlePickDemo(list[0].slug);
  };

  useEffect(() => {
    fetchDemoList(country).then(setDemos).catch(() => setDemos([]));
  }, [country]);

  // Recompute geodesic polygon area whenever vertices change
  useEffect(() => {
    if (polygonPath.length < 3) {
      setPolygonArea(0);
      return;
    }
    (async () => {
      const g = await loadGoogleMaps();
      try {
        const path = polygonPath.map((p) => new g.maps.LatLng(p.lat, p.lng));
        const area = (g.maps as any).geometry.spherical.computeArea(path);
        setPolygonArea(area);
      } catch (e) {
        console.error("computeArea failed", e);
        setPolygonArea(0);
      }
    })();
  }, [polygonPath]);

  const handlePick = async (t: { lat: number; lng: number; address?: string }) => {
    setHeroVisible(false);
    setDemoSlug(null);
    setTarget({ lat: t.lat, lng: t.lng, address: t.address });
    setSolar(null);
    setLoading(true);
    try {
      const data = await fetchSolar(t.lat, t.lng, t.address);
      setSolar({ ...data, address: data.address ?? t.address ?? null });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handlePickDemo = async (slug: string) => {
    setHeroVisible(false);
    setDemoSlug(slug);
    setLoading(true);
    setSolar(null);
    try {
      const d = await fetchDemo(slug);
      setTarget({ lat: d.lat, lng: d.lng, address: d.address ?? undefined, range: 320, tilt: 67, heading: 30 });
      setSolar(d);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSolar(null);
    setLoading(false);
    setTarget(null);
    setDemoSlug(null);
    setHeroVisible(true);
    cancelDrawing();
  };

  const handleCountryChange = (c: CountryCode) => {
    setCountry(c);
    setSolar(null);
    setLoading(false);
    setTarget(null);
    setDemoSlug(null);
    setHeroVisible(true);
    cancelDrawing();
  };

  const startDrawing = () => {
    setDrawingMode(true);
    setPolygonPath([]);
    setPolygonArea(0);
  };

  const cancelDrawing = () => {
    setDrawingMode(false);
    setPolygonPath([]);
    setPolygonArea(0);
    setDrawSubmitting(false);
  };

  const undoVertex = () => setPolygonPath((prev) => prev.slice(0, -1));

  const submitPolygon = async () => {
    if (!solar || polygonPath.length < 3 || polygonArea <= 0) return;
    setDrawSubmitting(true);
    try {
      const cx = polygonPath.reduce((s, p) => s + p.lat, 0) / polygonPath.length;
      const cy = polygonPath.reduce((s, p) => s + p.lng, 0) / polygonPath.length;
      const result = await fetchSolarManual({
        lat: cx,
        lng: cy,
        roof_area_m2: polygonArea,
        roof_type: drawRoofType,
        address: solar.address ?? undefined,
        country_code: solar.country_code,
      });
      setSolar({ ...result, address: result.address ?? solar.address });
      setDemoSlug(null);
      cancelDrawing();
    } catch (e) {
      console.error(e);
      setDrawSubmitting(false);
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg grain">
      {heroVisible && (
        <>
          <div className="absolute top-6 left-6 z-40">
            <CityRail current="TH" />
          </div>
          <a
            href="/"
            className="absolute top-6 right-6 z-40 flex items-center gap-2 px-3.5 py-2 rounded-xl glass hover:bg-white/[0.08] transition-colors group"
            title="Back to ASEAN Mission Control"
          >
            <Globe className="w-4 h-4 text-solar-400" />
            <span className="text-sm font-medium text-solar-gradient">ASEAN Mission Control</span>
          </a>
        </>
      )}
      <Map3D
        target={target}
        onPickLocation={handlePick}
        initialCenter={countryProfile.center}
        drawingMode={drawingMode}
        polygonPath={polygonPath}
        onDrawVertex={(v) => setPolygonPath((prev) => [...prev, v])}
      />

      <Hero
        visible={heroVisible}
        demos={demos}
        country={country}
        onPick={handlePick}
        onPickDemo={handlePickDemo}
        onCountryChange={handleCountryChange}
      />

      <AnimatePresence>
        {!heroVisible && !drawingMode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="absolute top-6 left-6 right-6 z-30 flex items-center gap-4"
          >
            <a
              href="/"
              className="flex items-center gap-2 px-3 py-2 rounded-xl glass hover:bg-white/[0.06] transition-colors"
              title="Back to ASEAN Mission Control"
            >
              <Globe className="w-4 h-4 text-solar-400" />
              <span className="text-sm font-medium text-white">HELIO Scout</span>
            </a>
            <CityRail current="TH" />
            <SearchBar onPick={handlePick} compact />
            <div className="ml-auto">
              <CountryToggle value={country} onChange={handleCountryChange} compact />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {country === "TH" && (
        <div className="v2 absolute bottom-6 left-6 z-40 flex flex-col items-start gap-2 w-[300px]">
          {showAir && (
            <div className="v2-panel p-1 w-full" data-tour="air-card">
              <HazePanel city="bangkok" startYear={2026} />
            </div>
          )}
          <div className="flex gap-2">
            <DemoTour label="Bangkok demo" storageKey="helios-bkk-demo" steps={bangkokDemo(pickFirstDemo, setShowAir)} />
            <button onClick={() => setShowAir((v) => !v)} className="v2-btn">
              {showAir ? "Hide air" : "Air today"}
            </button>
          </div>
        </div>
      )}

      <Sidebar
        solar={solar}
        loading={loading}
        demoSlug={demoSlug}
        onClose={handleClose}
        onStartDrawing={!drawingMode ? startDrawing : undefined}
      />

      <DrawToolbar
        visible={drawingMode}
        vertexCount={polygonPath.length}
        areaM2={polygonArea}
        roofType={drawRoofType}
        onRoofTypeChange={setDrawRoofType}
        onUndo={undoVertex}
        onCancel={cancelDrawing}
        onCalculate={submitPolygon}
        loading={drawSubmitting}
      />

      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{ background: "radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.45) 100%)" }}
      />
    </div>
  );
}
