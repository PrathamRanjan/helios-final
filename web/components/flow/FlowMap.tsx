"use client";

// The HELIO Flow sandbox canvas: token-free deck.gl vector city (OSM buildings +
// roads from frozen JSON) with a lightweight point/line/polygon draw tool.
// Drawn geometry becomes WorldModifiers — the map is the input device.

import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { MapView, FlyToInterpolator } from "@deck.gl/core";
import { ArcLayer, PolygonLayer, PathLayer, ScatterplotLayer, GeoJsonLayer } from "@deck.gl/layers";
import { rampFor, type ModifierGeometry, type WorldModifier, type EvSite } from "@/lib/compass/flow/scenario";
import { useAgents } from "@/lib/compass/flow/useAgents";
import { useIslandWorld, type PickedBuilding } from "@/lib/compass/flow/useIslandWorld";
import type { ModeSplit } from "@/lib/compass/agents";

export interface DetectedCorridor {
  id: string;
  from: string;
  to: string;
  fromPos: [number, number];
  toPos: [number, number];
  tripsPerDay: number;
  distKm: number;
  shadeDeficit: number;
}

const INITIAL_VIEW = { longitude: 103.7421, latitude: 1.3334, zoom: 14.8, pitch: 50, bearing: 20 };

export type DrawMode = "point" | "line" | "polygon" | null;

interface VectorCity {
  buildings: { polygon: [number, number][]; height?: number }[];
  roads: { path: [number, number][]; kind: string }[];
  cycling: { path: [number, number][] }[];
}

interface ClientNode {
  code: string;
  type: "BUS" | "TRAIN";
  name: string;
  lat: number;
  lng: number;
  volume: number;
}

interface ClientFlow {
  trips: number;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

interface ShadeSegment {
  id: string;
  from: [number, number];
  to: [number, number];
  shade: number;
  effHeat: number;
  tripsPerDay: number;
}

interface Props {
  drawMode: DrawMode;
  draft: [number, number][];
  onDraftChange: (pts: [number, number][]) => void;
  onFinish: (geometry: ModifierGeometry) => void;
  modifiers: WorldModifier[];
  showFlows: boolean;
  detected: DetectedCorridor[];
  highlightId: string | null;
  /** The world clock — modifiers fade in at their build year. */
  year: number;
  /** Selected year's simulated mode split; drives agent composition. */
  modeShare: ModeSplit | null;
  agentsOn: boolean;
  /** Demand vs normal for the selected year (pandemic thins the streets). */
  demandFactor: number;
  /** Increments on each "watch the city evolve" press → a dramatic agent surge. */
  pulse: number;
  /** HELIO-recommended EV sites (glowing pins; click to accept). */
  evSites: EvSite[];
  onEvSiteClick: (site: EvSite) => void;
  /** Heat-exposure layer: corridors colored by effective heat. */
  showHeat: boolean;
  /** Planning area being simulated (data/areas/<id>). */
  areaId?: string;
  /** Camera framing for the area. */
  initialView?: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number };
  /** Area boundary outline (GeoJSON ring) drawn on the ground. */
  boundary?: [number, number][][];
  /** Compliance markers: BCA buildings coloured by their Green Mark 2021 result. */
  markers?: { id: string; lng: number; lat: number; color: [number, number, number, number]; label: string }[];
  /** Camera target — changing it flies the camera there. */
  flyTo?: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number; key?: string } | null;
  onViewChange?: (v: { longitude: number; latitude: number; zoom: number }) => void;
  /** Island-wide world (skyline, roads, rail traffic) under the area simulation. */
  island?: boolean;
  carShareByArea?: Record<string, number>;
  onPickBuilding?: (b: PickedBuilding) => void;
  /** Agents (calibrated corridor simulation) only where the area's LTA world exists. */
  simulationReady?: boolean;
  /** Highlighted building (selected in the inspector). */
  pickedBuilding?: PickedBuilding | null;
  /** Nature + physical-risk layer: reserves, nature areas, coastal habitat, PUB flood spots, heritage trees. */
  showNature?: boolean;
}

export default function FlowMap({
  drawMode,
  draft,
  onDraftChange,
  onFinish,
  modifiers,
  showFlows,
  detected,
  highlightId,
  year,
  modeShare,
  agentsOn,
  demandFactor,
  pulse,
  evSites,
  onEvSiteClick,
  showHeat,
  areaId = "jurong_east",
  initialView = INITIAL_VIEW,
  boundary,
  markers = [],
  flyTo = null,
  onViewChange,
  island = false,
  carShareByArea,
  onPickBuilding,
  simulationReady = true,
  pickedBuilding = null,
  showNature = false,
}: Props) {
  const [viewState, setViewState] = useState<any>(initialView);
  // Film mode (/sg?film=1): the capture script drives the camera directly.
  useEffect(() => {
    (window as any).__heliosSetView = (v: any) => setViewState((cur: any) => ({ ...cur, ...v, transitionDuration: 0 }));
    return () => {
      delete (window as any).__heliosSetView;
    };
  }, []);
  useEffect(() => {
    if (!flyTo) return;
    setViewState((v: any) => ({ ...v, ...flyTo, transitionDuration: 2200, transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.key ?? `${flyTo?.longitude},${flyTo?.latitude},${flyTo?.zoom}`]);
  const [city, setCity] = useState<VectorCity | null>(null);
  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [flows, setFlows] = useState<ClientFlow[]>([]);
  const [shadeSegs, setShadeSegs] = useState<ShadeSegment[]>([]);
  const [rail, setRail] = useState<{ t: string; c: [number, number][] }[]>([]);

  useEffect(() => {
    if (!showHeat || shadeSegs.length) return;
    fetch(`/api/compass/shade/segments?area=${areaId}`)
      .then((r) => r.json())
      .then((d) => setShadeSegs(d.segments ?? []))
      .catch(() => {});
  }, [showHeat, shadeSegs.length, areaId]);

  useEffect(() => {
    setCity(null);
    setNodes([]);
    setFlows([]);
    setShadeSegs([]);
    if (!island) fetch(`/api/district/${areaId}/vector`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setCity(d)).catch(() => {});
    if (!simulationReady || !areaId) return;
    fetch(`/api/district/${areaId}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: any) => {
        setNodes(d.nodes ?? []);
        setFlows(d.flows ?? []);
      })
      .catch(() => {});
  }, [areaId, island, simulationReady]);

  useEffect(() => {
    // Real OSM rail/subway track — drawn on actual alignment, not station-to-station.
    fetch("/api/compass/geo/rail")
      .then((r) => r.json())
      .then((d) => setRail(d.lines ?? []))
      .catch(() => {});
  }, []);

  const [nature, setNature] = useState<any>(null);
  useEffect(() => {
    if (!showNature || nature) return;
    fetch("/api/sg/layer/nature")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setNature(d))
      .catch(() => {});
  }, [showNature, nature]);

  // Nature + physical risk: green = protected reserve / national park, teal = nature area,
  // cyan = sensitive coastal habitat, blue = PUB flood-prone spot, amber = heritage tree.
  const natureLayer = useMemo(() => {
    if (!showNature || !nature) return [];
    const FILL: Record<string, [number, number, number, number]> = {
      protected: [74, 222, 128, 70],
      nature_area: [45, 212, 191, 55],
      marine: [56, 189, 248, 30],
      habitat: [34, 211, 238, 110],
    };
    const LINE: Record<string, [number, number, number, number]> = {
      protected: [134, 239, 172, 220],
      nature_area: [94, 234, 212, 200],
      marine: [125, 211, 252, 120],
      habitat: [103, 232, 249, 200],
    };
    const polys = nature.features.filter((f: any) => f.geometry.type !== "Point");
    const pts = nature.features.filter((f: any) => f.geometry.type === "Point");
    return [
      new GeoJsonLayer({
        id: "nature-areas",
        data: { type: "FeatureCollection", features: polys } as any,
        filled: true,
        stroked: true,
        getFillColor: (f: any) => FILL[f.properties.kind] ?? [148, 163, 184, 40],
        getLineColor: (f: any) => LINE[f.properties.kind] ?? [148, 163, 184, 120],
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        pickable: true,
      }),
      new ScatterplotLayer({
        id: "flood-spots-glow",
        data: pts.filter((f: any) => f.properties.kind === "flood"),
        getPosition: (f: any) => f.geometry.coordinates,
        getRadius: 300,
        radiusUnits: "meters",
        getFillColor: [59, 130, 246, 40],
        getLineColor: [96, 165, 250, 160],
        lineWidthMinPixels: 1,
        stroked: true,
      }),
      new ScatterplotLayer({
        id: "nature-points",
        data: pts.map((f: any) => ({ ...f, label: f.properties.kind === "flood" ? `PUB flood-prone: ${f.properties.label}` : `Heritage tree: ${f.properties.label}` })),
        getPosition: (f: any) => f.geometry.coordinates,
        getRadius: (f: any) => (f.properties.kind === "flood" ? 40 : 14),
        radiusUnits: "meters",
        radiusMinPixels: 3,
        getFillColor: (f: any) => (f.properties.kind === "flood" ? [96, 165, 250, 240] : [245, 184, 61, 220]),
        getLineColor: [6, 8, 11, 255],
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
      }),
    ];
  }, [showNature, nature]);

  // Static city layers — memoized so they never rebuild per interaction (V2 gotcha).
  const cityLayers = useMemo(() => {
    const outline = boundary?.length
      ? [
          new PathLayer({
            id: "area-boundary",
            data: boundary.map((ring) => ({ ring })),
            getPath: (d: any) => d.ring,
            getColor: [94, 234, 212, 140],
            getWidth: 2,
            widthUnits: "pixels",
            getDashArray: [6, 4],
          }),
        ]
      : [];
    if (!city) return outline;
    return [
      ...outline,
      new PathLayer({
        id: "roads",
        getPath: (d: any) => d.path,
        data: city.roads,
        getColor: [70, 80, 97, 190],
        getWidth: (d: any) => (["motorway", "trunk", "primary"].includes(d.kind) ? 7 : d.kind === "secondary" ? 5 : ["footway", "path", "steps", "pedestrian", "service"].includes(d.kind) ? 1.2 : 2.5),
        widthUnits: "meters",
      }),
      new PathLayer({
        id: "cycling",
        data: city.cycling,
        getPath: (d: any) => d.path,
        getColor: [45, 160, 110, 120],
        getWidth: 2,
        widthUnits: "meters",
      }),
      new PolygonLayer({
        id: "buildings",
        data: city.buildings,
        extruded: true,
        getPolygon: (d: any) => d.polygon,
        getElevation: (d: any) => d.height ?? 8,
        getFillColor: [52, 61, 77, 245],
        getLineColor: [80, 92, 110, 90],
        material: { ambient: 0.55, diffuse: 0.5, shininess: 20, specularColor: [40, 40, 50] },
      }),
    ];
  }, [city, boundary]);

  // Real OSM rail/subway track — a steel double-line so trains read as running
  // on the actual alignment, not straight station-to-station links.
  const railLayer = useMemo(() => {
    if (!rail.length) return [];
    return [
      new PathLayer({
        id: "rail-casing",
        data: rail,
        getPath: (d: any) => d.c,
        getColor: [148, 163, 184, 90],
        getWidth: 9,
        widthUnits: "meters",
        widthMinPixels: 2.5,
        capRounded: true,
        jointRounded: true,
      }),
      new PathLayer({
        id: "rail-track",
        data: rail,
        getPath: (d: any) => d.c,
        getColor: [203, 213, 225, 200],
        getWidth: 3.5,
        widthUnits: "meters",
        widthMinPixels: 1,
        capRounded: true,
        jointRounded: true,
      }),
    ];
  }, [rail]);

  const nodeLayer = useMemo(
    () =>
      new ScatterplotLayer({
        id: "transit-nodes",
        data: nodes,
        getPosition: (d: any) => [d.lng, d.lat],
        getRadius: (d: any) => (d.type === "TRAIN" ? 46 : 12 + Math.min(20, d.volume / 30000)),
        radiusUnits: "meters",
        getFillColor: (d: any) => (d.type === "TRAIN" ? [94, 234, 212, 220] : [148, 163, 184, 120]),
        pickable: true,
      }),
    [nodes]
  );

  // Baseline mobility flows (real fare-card OD, top corridors) as thin arcs.
  const flowLayer = useMemo(() => {
    if (!showFlows || !flows.length) return [];
    const maxTrips = flows[0]?.trips ?? 1;
    return [
      new ArcLayer({
        id: "od-flows",
        data: flows,
        getSourcePosition: (d: any) => [d.from.lng, d.from.lat],
        getTargetPosition: (d: any) => [d.to.lng, d.to.lat],
        getSourceColor: [94, 234, 212, 80],
        getTargetColor: [245, 184, 61, 90],
        getWidth: (d: any) => 1 + (d.trips / maxTrips) * 5,
        widthUnits: "pixels",
        getHeight: 0.35,
      }),
    ];
  }, [flows, showFlows]);

  // HELIO-detected shade-deficit corridors (status: problem), hovered one emphasized.
  const detectedLayer = useMemo(() => {
    if (!detected.length) return [];
    return [
      new ArcLayer({
        id: "detected",
        data: detected,
        getSourcePosition: (d: any) => d.fromPos,
        getTargetPosition: (d: any) => d.toPos,
        getSourceColor: (d: any) => [244, 63, 94, d.id === highlightId ? 240 : 130],
        getTargetColor: (d: any) => [244, 63, 94, d.id === highlightId ? 240 : 130],
        getWidth: (d: any) => (d.id === highlightId ? 6 : 2.5),
        widthUnits: "pixels",
        getHeight: 0.5,
        updateTriggers: { getSourceColor: highlightId, getTargetColor: highlightId, getWidth: highlightId },
      }),
    ];
  }, [detected, highlightId]);

  // User modifiers overlay — each fades in at its build year with the adoption
  // ramp (time-lapse: scrub past 2030 and your 2030 corridor materialises).
  const modifierLayers = useMemo(() => {
    const points = modifiers.filter((m) => m.geometry.type === "Point");
    const lines = modifiers.filter((m) => m.geometry.type === "LineString");
    const polys = modifiers.filter((m) => m.geometry.type === "Polygon");
    const alpha = (m: WorldModifier, max: number) =>
      Math.round(Math.max(0.12, rampFor(year, m.metadata.builtYear)) * max);
    return [
      new PolygonLayer({
        id: "mod-polys",
        data: polys,
        getPolygon: (d: any) => d.geometry.coordinates[0],
        getFillColor: (d: any) => [217, 119, 6, alpha(d, 45)],
        getLineColor: (d: any) => [217, 119, 6, alpha(d, 220)],
        getLineWidth: 3,
        lineWidthUnits: "meters",
        stroked: true,
        filled: true,
        pickable: true,
        updateTriggers: { getFillColor: year, getLineColor: year },
      }),
      new PathLayer({
        id: "mod-lines",
        data: lines,
        getPath: (d: any) => d.geometry.coordinates,
        getColor: (d: any) => [217, 119, 6, alpha(d, 230)],
        getWidth: 6,
        widthUnits: "meters",
        pickable: true,
        updateTriggers: { getColor: year },
      }),
      new ScatterplotLayer({
        id: "mod-points",
        data: points,
        getPosition: (d: any) => d.geometry.coordinates,
        getRadius: 30,
        radiusUnits: "meters",
        getFillColor: (d: any) => [217, 119, 6, alpha(d, 200)],
        getLineColor: [255, 244, 212, 230],
        lineWidthMinPixels: 1.5,
        stroked: true,
        pickable: true,
        updateTriggers: { getFillColor: year },
      }),
    ];
  }, [modifiers, year]);

  // The living population — few big units, composition follows the year's split.
  const agentLayers = useAgents(modeShare, agentsOn && simulationReady, demandFactor, pulse, areaId, [initialView.longitude, initialView.latitude]);
  const islandLayers = useIslandWorld({
    enabled: island,
    view: viewState,
    carShareByArea,
    selectedAreaId: areaId,
    onPickBuilding,
  });
  const pickedLayer = useMemo(() => {
    if (!pickedBuilding) return [];
    return [
      pickedBuilding.polygon
        ? new PolygonLayer({ id: "picked-building", data: [pickedBuilding], extruded: true, getPolygon: (d: any) => d.polygon, getElevation: (d: any) => d.height + 0.5, getFillColor: [245, 184, 61, 200], getLineColor: [245, 184, 61, 255] })
        : new ScatterplotLayer({ id: "picked-building", data: [pickedBuilding], getPosition: (d: any) => [d.lng, d.lat, d.height + 4], getRadius: 22, radiusUnits: "meters", radiusMinPixels: 6, getFillColor: [245, 184, 61, 240], stroked: true, getLineColor: [255, 255, 255, 220], lineWidthMinPixels: 1.5 }),
    ];
  }, [pickedBuilding]);

  // Heat-exposure layer: sequential single-hue ramp (light→dark rose) on the
  // top corridors — where exposed active travel is being suppressed.
  const heatLayer = useMemo(() => {
    if (!showHeat || !shadeSegs.length) return [];
    const lo = 0.7 * (1 - 0.75); // fully-shaded floor
    const hi = 0.7 * (1 - 0.12); // fully-exposed ceiling
    return [
      new PathLayer({
        id: "heat-exposure",
        data: shadeSegs,
        getPath: (d: any) => [d.from, d.to],
        getColor: (d: any) => {
          const t = Math.max(0, Math.min(1, (d.effHeat - lo) / (hi - lo)));
          return [244, 63, 94, 30 + t * 190];
        },
        getWidth: (d: any) => 2.5 + Math.min(6, d.tripsPerDay / 400),
        widthUnits: "meters",
        widthMinPixels: 1,
        capRounded: true,
      }),
    ];
  }, [showHeat, shadeSegs]);

  // "Recommended by HELIO" EV opportunity pins — click to accept into the world.
  const evLayer = useMemo(() => {
    if (!evSites.length) return [];
    return [
      new ScatterplotLayer({
        id: "ev-sites-glow",
        data: evSites,
        getPosition: (d: any) => [d.lng, d.lat],
        getRadius: (d: any) => 55 + d.score * 60,
        radiusUnits: "meters",
        getFillColor: [56, 189, 248, 45],
        stroked: false,
      }),
      new ScatterplotLayer({
        id: "ev-sites",
        data: evSites,
        getPosition: (d: any) => [d.lng, d.lat],
        getRadius: 26,
        radiusUnits: "meters",
        getFillColor: [56, 189, 248, 230],
        getLineColor: [255, 255, 255, 220],
        lineWidthMinPixels: 1.5,
        stroked: true,
        pickable: true,
        onClick: (info: any) => {
          if (info.object) onEvSiteClick(info.object as EvSite);
          return true;
        },
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evSites]);

  const markerLayer = useMemo(() => {
    if (!markers.length) return [];
    return [
      new ScatterplotLayer({
        id: "compliance-markers",
        data: markers,
        getPosition: (d: any) => [d.lng, d.lat, 60],
        getRadius: 34,
        radiusUnits: "meters",
        radiusMinPixels: 4,
        getFillColor: (d: any) => d.color,
        getLineColor: [6, 8, 11, 255],
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
      }),
    ];
  }, [markers]);

  // In-progress draft geometry.
  const draftLayers = useMemo(() => {
    if (!draft.length) return [];
    return [
      new PathLayer({
        id: "draft-line",
        data: [{ path: draft }],
        getPath: (d: any) => d.path,
        getColor: [255, 210, 74, 200],
        getWidth: 4,
        widthUnits: "meters",
      }),
      new ScatterplotLayer({
        id: "draft-pts",
        data: draft.map((p) => ({ p })),
        getPosition: (d: any) => d.p,
        getRadius: 14,
        radiusUnits: "meters",
        getFillColor: [255, 210, 74, 255],
      }),
    ];
  }, [draft]);

  // Double-click finishes a line/polygon. The second click of the pair already
  // added a near-duplicate vertex via onClick — drop it before finishing.
  const finishDraft = () => {
    if (!drawMode || drawMode === "point") return;
    let pts = draft;
    if (pts.length >= 2) {
      const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
      if (Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5) pts = pts.slice(0, -1);
    }
    if (drawMode === "line" && pts.length >= 2) {
      onFinish({ type: "LineString", coordinates: pts });
    } else if (drawMode === "polygon" && pts.length >= 3) {
      onFinish({ type: "Polygon", coordinates: [[...pts, pts[0]]] });
    }
    onDraftChange([]);
  };

  return (
    <div className="absolute inset-0" onDoubleClick={finishDraft}>
      <DeckGL
        views={new MapView({ id: "main" })}
        viewState={viewState}
        onViewStateChange={({ viewState: v }: any) => {
          setViewState(v);
          onViewChange?.(v);
        }}
        controller={{ doubleClickZoom: false, dragRotate: true }}
        layers={[...islandLayers, ...cityLayers, ...natureLayer, ...railLayer, ...heatLayer, ...flowLayer, ...detectedLayer, nodeLayer, ...evLayer, ...modifierLayers, ...agentLayers, ...markerLayer, ...pickedLayer, ...draftLayers]}
        getTooltip={({ object }: any) => (object?.label || object?.properties?.label ? { text: object.label ?? object.properties.label, style: { background: "#0b0e13", color: "#e6ebf1", fontSize: "11px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "4px", padding: "6px 8px" } } : null)}
        getCursor={({ isDragging }) => (drawMode ? "crosshair" : isDragging ? "grabbing" : "grab")}
        onClick={(info: any) => {
          if (!drawMode || !info.coordinate) return;
          const pt: [number, number] = [info.coordinate[0], info.coordinate[1]];
          if (drawMode === "point") {
            onFinish({ type: "Point", coordinates: pt });
            onDraftChange([]);
          } else {
            onDraftChange([...draft, pt]);
          }
        }}
      />
    </div>
  );
}
