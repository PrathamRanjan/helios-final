"use client";

// Hanoi EV Grid map — click-to-deploy version.
// Layers:
//   1. Carto dark basemap tiles
//   2. Ring Road 1 boundary polygon (red — ICE ban zone)
//   3. Existing chargers (grey dots — 203 VinFast from OSM)
//   4. Undeployed candidate chargers (dim outline dots)
//   5. Deployed candidate chargers (bright solid dots with halo)

import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { PolygonLayer, ScatterplotLayer, BitmapLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";

const INITIAL_VIEW = {
  longitude: 105.845,
  latitude: 21.028,
  zoom: 11.5,
  pitch: 45,
  bearing: -8,
};

const TYPE_COLOR: Record<string, [number, number, number]> = {
  ev_level_2:   [52,  211, 153],
  dc_fast:      [56,  189, 248],
  solar_canopy: [251, 191, 36],
};

interface Charger {
  id: string;
  name: string;
  lat: number;
  lng: number;
  recommended_type?: string;
  capex_usd?: number;
}

interface Props {
  existingChargers: Charger[];
  candidateChargers: Charger[];
  deployedIds: Set<string>;
  ringRoadCoords: [number, number][] | null;
  onCandidateClick?: (site: any) => void;
  remainingBudget: number;
}

export default function HanoiMap({
  existingChargers,
  candidateChargers,
  deployedIds,
  ringRoadCoords,
  onCandidateClick,
  remainingBudget,
}: Props) {
  const deployed = useMemo(
    () => candidateChargers.filter((s) => deployedIds.has(s.id)),
    [candidateChargers, deployedIds]
  );
  const undeployed = useMemo(
    () => candidateChargers.filter((s) => !deployedIds.has(s.id)),
    [candidateChargers, deployedIds]
  );

  const layers = useMemo(() => {
    const tileLayer = new TileLayer({
      id: "basemap",
      data: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      renderSubLayers: (props: any) => {
        const { boundingBox } = props.tile;
        const overrides = {
          data: undefined,
          image: props.data,
          bounds: [
            boundingBox[0][0], boundingBox[0][1],
            boundingBox[1][0], boundingBox[1][1],
          ],
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new (BitmapLayer as any)(props, overrides);
      },
    });

    const ringRoadLayer = ringRoadCoords
      ? new PolygonLayer({
          id: "ring-road-1",
          data: [{ polygon: ringRoadCoords }],
          getPolygon: (d: any) => d.polygon,
          filled: true,
          stroked: true,
          getFillColor: [255, 55, 55, 22],
          getLineColor: [255, 80, 80, 200],
          getLineWidth: 40,
          lineWidthMinPixels: 2,
          pickable: false,
        })
      : null;

    const existingLayer = new ScatterplotLayer({
      id: "existing-chargers",
      data: existingChargers,
      getPosition: (d: Charger) => [d.lng, d.lat],
      getRadius: 8,
      radiusMinPixels: 3,
      radiusMaxPixels: 12,
      getFillColor: [160, 160, 170, 180],
      getLineColor: [120, 120, 130, 120],
      stroked: true,
      lineWidthMinPixels: 1,
      pickable: true,
    });

    // Undeployed candidates — dim outline dots, clickable
    const undeployedLayer = new ScatterplotLayer({
      id: "undeployed-candidates",
      data: undeployed,
      getPosition: (d: Charger) => [d.lng, d.lat],
      getRadius: 12,
      radiusMinPixels: 5,
      radiusMaxPixels: 16,
      filled: false,
      stroked: true,
      getLineColor: (d: Charger) => {
        const c = TYPE_COLOR[d.recommended_type ?? "ev_level_2"];
        const affordable = (d.capex_usd ?? 0) <= remainingBudget;
        return [...c, affordable ? 140 : 50] as any;
      },
      lineWidthMinPixels: 1.5,
      pickable: true,
      onClick: (info: any) => {
        if (info.object && onCandidateClick) onCandidateClick(info.object);
        return true;
      },
      getCursor: () => "pointer",
      updateTriggers: { getLineColor: [undeployed, remainingBudget] },
    });

    // Deployed halo
    const deployedHaloLayer = new ScatterplotLayer({
      id: "deployed-halo",
      data: deployed,
      getPosition: (d: Charger) => [d.lng, d.lat],
      getRadius: 22,
      radiusMinPixels: 9,
      getFillColor: (d: Charger) => [...(TYPE_COLOR[d.recommended_type ?? "ev_level_2"]), 45] as any,
      stroked: false,
      pickable: false,
      updateTriggers: { getFillColor: deployed },
    });

    // Deployed candidates — bright solid dots
    const deployedLayer = new ScatterplotLayer({
      id: "deployed-chargers",
      data: deployed,
      getPosition: (d: Charger) => [d.lng, d.lat],
      getRadius: 12,
      radiusMinPixels: 6,
      radiusMaxPixels: 18,
      getFillColor: (d: Charger) => [...(TYPE_COLOR[d.recommended_type ?? "ev_level_2"]), 230] as any,
      getLineColor: (d: Charger) => [...(TYPE_COLOR[d.recommended_type ?? "ev_level_2"]), 255] as any,
      stroked: true,
      lineWidthMinPixels: 1,
      pickable: true,
      updateTriggers: { getFillColor: deployed, getLineColor: deployed },
      onClick: (info: any) => {
        if (info.object && onCandidateClick) onCandidateClick(info.object);
        return true;
      },
      getCursor: () => "pointer",
    });

    return [tileLayer, ringRoadLayer, existingLayer, undeployedLayer, deployedHaloLayer, deployedLayer].filter(Boolean);
  }, [existingChargers, deployed, undeployed, ringRoadCoords, remainingBudget]);

  return (
    <DeckGL
      views={new MapView({ repeat: true })}
      initialViewState={INITIAL_VIEW}
      controller
      layers={layers}
      style={{ background: "#0A0B0F" }}
    />
  );
}
