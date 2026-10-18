"use client";

// Nature + physical risk (TNFD "Locate") from open data only: URA nature areas,
// NParks habitats, ESA WorldCover, Copernicus DEM, PUB flood-prone list, GBIF.
// Thresholds live in data/nature/screening.json — every flag says whether it is
// a Singapore rule ("cited") or a HELIOS screening choice ("screen").

import { useEffect, useState } from "react";
import { Leaf, Droplets, Sun, Bird, Loader2, TreePine, Info } from "lucide-react";
import { Label, Stat, ConfChip, fmtInt, fmtPct } from "@/components/v2/ui";
import { ReplacesStrip } from "@/components/v2/OpenStack";
import { CAVEATS, FRAMEWORK, LEVEL_TONE, type Group, type Level, type ScreenHit, type NatureValues } from "@/lib/compass/nature/screen";

interface AreaSummary {
  area_km2: number;
  nature_area_share: number;
  protected_share: number;
  tree_cover: number;
  vegetation_cover: number;
  mangrove_ha: number;
  buildings: number;
  bld_near_protected_500m: number;
  bld_near_nature_100m: number;
  bld_ground_below_4m: number;
  bld_near_flood_spot_300m: number;
  bld_low_greenery: number;
  flood_spots: ({ sn: number; location: string } | number)[];
  heritage_trees: number;
  gbif: {
    records: number;
    species: number;
    threatened_species: number;
    threatened_records: number;
    top_threatened: { name: string; vernacular?: string | null; class?: string; records: number; introduced?: boolean }[];
  };
}

const GROUP_META: Record<Group, { label: string; icon: any }> = {
  nature: { label: "Nature", icon: Leaf },
  flood: { label: "Flood & sea level", icon: Droplets },
  heat: { label: "Heat", icon: Sun },
};

function LevelPill({ group, level }: { group: Group; level: Level }) {
  const { label, icon: Icon } = GROUP_META[group];
  return (
    <div className={`rounded-[4px] border px-2 py-1.5 ${LEVEL_TONE[level]}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
        <Icon size={11} /> {label}
      </div>
      <div className="mono text-[13px] mt-0.5 capitalize">{level}</div>
    </div>
  );
}

function Basis({ basis }: { basis: "cited" | "method" }) {
  return (
    <span
      className={`mono rounded-[3px] border px-1 text-[9px] uppercase tracking-wider ${basis === "cited" ? "border-signal-400/40 text-signal-300" : "border-line text-white/45"}`}
      title={basis === "cited" ? "Threshold from a Singapore rule or agency" : "HELIOS screening threshold — a flag for a closer look, not a finding"}
    >
      {basis === "cited" ? "cited" : "screen"}
    </span>
  );
}

const m = (d: number) => (d >= 9999 ? "> 10 km" : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : d === 0 ? "inside" : `${d} m`);

/** Building-level card for the Building tab. */
export function SiteNature({ lng, lat }: { lng: number; lat: number }) {
  const [d, setD] = useState<{ values: NatureValues; groups: Record<Group, Level>; hits: ScreenHit[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    setErr(null);
    fetch(`/api/sg/nature?lng=${lng}&lat=${lat}`)
      .then((r) => r.json())
      .then((x) => (x.error ? setErr(x.error) : setD(x)))
      .catch((e) => setErr(String(e)));
  }, [lng, lat]);
  return (
    <div className="rounded-[4px] border border-line p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-white">
          <TreePine size={14} className="text-signal-300" /> Nature & physical risk
        </div>
        <ConfChip conf="screening estimate" />
      </div>
      {err && <div className="text-[11px] text-risk-300 mt-2">{err}</div>}
      {!d && !err && (
        <div className="flex items-center gap-2 py-3 text-[11px] text-white/40">
          <Loader2 size={12} className="animate-spin" /> Screening…
        </div>
      )}
      {d && (
        <>
          <div className="grid grid-cols-3 gap-1.5 mt-2.5">
            {(["nature", "flood", "heat"] as Group[]).map((g) => (
              <LevelPill key={g} group={g} level={d.groups[g]} />
            ))}
          </div>
          {d.hits.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {d.hits.map((h) => (
                <div key={h.id} className="text-[11px] leading-snug">
                  <div className="flex items-center gap-1.5">
                    <span className={h.level === "high" ? "text-risk-300" : "text-warn-300"}>●</span>
                    <span className="text-white/80">{h.label}</span>
                    <Basis basis={h.basis} />
                  </div>
                  <div className="text-white/40 pl-3.5">{h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="hover:text-white/70 underline decoration-white/20">{h.source}</a> : h.source}</div>
                </div>
              ))}
            </div>
          )}
          <table className="w-full text-[11px] mt-2.5">
            <tbody>
              {[
                ["Nature reserve / national park", m(d.values.d_protected)],
                ["Any nature area", m(d.values.d_nature)],
                ["Mangrove / seagrass / coral / mudflat", m(d.values.d_habitat)],
                ["Canal, drain or reservoir", m(d.values.d_water)],
                ["Nearest PUB flood-prone spot", m(d.values.d_flood)],
                ["Ground level (est.)", d.values.ground_m == null ? "—" : `${d.values.ground_m.toFixed(1)} m above sea level`],
                ["Greenery within 100 m", `${d.values.veg_100m}%`],
                ["Master Plan 2025 zoning", d.values.land_use ? d.values.land_use.toLowerCase() : "—"],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-line/50">
                  <td className="py-1 text-white/50">{k}</td>
                  <td className="py-1 text-right mono text-white/80">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-white/35 mt-1.5 leading-snug">Ground level is estimated from a 30 m satellite surface model (±2–4 m). A surveyed platform level always overrides it.</div>
          <ReplacesStrip id="physical_risk" className="mt-2.5" />
        </>
      )}
    </div>
  );
}

/** Area-level panel for the Nature tab. */
export function AreaNature({ areaId, areaName, showLayer, onToggleLayer }: { areaId: string; areaName: string; showLayer: boolean; onToggleLayer: () => void }) {
  const [a, setA] = useState<AreaSummary | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setA(null);
    setErr(null);
    fetch(`/api/sg/nature?area=${areaId}`)
      .then((r) => r.json())
      .then((x) => {
        if (x.error) return setErr(x.error);
        setA(x.summary);
        setSources(x.sources ?? {});
      })
      .catch((e) => setErr(String(e)));
  }, [areaId]);

  if (err) return <div className="text-[11.5px] text-risk-300">{err}</div>;
  if (!a)
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-[11.5px] text-white/40">
        <Loader2 size={13} className="animate-spin" /> Loading nature data…
      </div>
    );
  const pct = (n: number) => (a.buildings ? fmtPct(n / a.buildings, 1) : "—");
  return (
    <div className="space-y-4" data-tour="nature">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label>Nature & physical risk · {areaName}</Label>
          <div className="text-[10.5px] text-white/40 mt-0.5">
            TNFD "Locate" screening from open data ·{" "}
            <a href={FRAMEWORK.url} target="_blank" rel="noreferrer" className="underline decoration-white/20 hover:text-white/70">
              LEAP approach
            </a>
          </div>
        </div>
        <button onClick={onToggleLayer} className="v2-btn !h-7 shrink-0" data-active={showLayer}>
          <Leaf size={12} className="text-signal-300" /> {showLayer ? "Hide map" : "Show on map"}
        </button>
      </div>

      <ReplacesStrip id="nature_risk" />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Tree cover" value={fmtPct(a.tree_cover)} tone="signal" sub={`${fmtPct(a.vegetation_cover)} any vegetation`} />
        <Stat label="Nature areas" value={fmtPct(a.nature_area_share, a.nature_area_share > 0 && a.nature_area_share < 0.01 ? 1 : 0)} sub={a.protected_share ? `${fmtPct(a.protected_share)} reserve / park` : "no reserve / park"} />
        <Stat label="Heritage trees" value={a.heritage_trees} sub={a.mangrove_ha ? `${a.mangrove_ha} ha mangrove` : undefined} />
      </div>

      <div className="rounded-[4px] border border-line p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12.5px] text-white">
            <Bird size={14} className="text-signal-300" /> Biodiversity records
          </div>
          <ConfChip conf="measured" />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-2.5">
          <Stat label="Records" value={fmtInt(a.gbif.records)} />
          <Stat label="Species" value={fmtInt(a.gbif.species)} />
          <Stat label="Threatened" value={a.gbif.threatened_species} tone={a.gbif.threatened_species ? "warn" : "default"} sub="CR · EN · VU" />
        </div>
        {a.gbif.top_threatened.length > 0 && (
          <div className="mt-2.5 space-y-0.5">
            {a.gbif.top_threatened.map((t) => (
              <div key={t.name} className="flex justify-between text-[11px]">
                <span className="text-white/75 truncate">
                  {t.vernacular ? <span className="capitalize">{t.vernacular}</span> : null} <i className="text-white/40">{t.name}</i>
                  {t.introduced && <span className="mono ml-1.5 rounded-[3px] border border-line px-1 text-[9px] uppercase text-white/45" title="Globally threatened, but introduced in Singapore">introduced</span>}
                </span>
                <span className="mono text-white/45 shrink-0 ml-2">{fmtInt(t.records)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-white/35 mt-2 leading-snug">GBIF.org occurrences inside the area. Counts follow where people look as much as where species live. Threatened = IUCN CR/EN/VU globally (via GBIF; non-commercial licence), so introduced species can appear — they are tagged and listed last.</div>
      </div>

      <div className="rounded-[4px] border border-line p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12.5px] text-white">
            <Droplets size={14} className="text-sky-300" /> Buildings exposed
          </div>
          <ConfChip conf="screening estimate" />
        </div>
        <table className="w-full text-[11.5px] mt-2">
          <tbody>
            {[
              ["Ground below 4 m (PUB minimum platform level)", a.bld_ground_below_4m],
              ["Within 300 m of a PUB flood-prone spot", a.bld_near_flood_spot_300m],
              ["Within 500 m of a reserve / national park", a.bld_near_protected_500m],
              ["Within 100 m of a nature area", a.bld_near_nature_100m],
              ["Under 10% greenery within 100 m (heat)", a.bld_low_greenery],
            ].map(([k, v]) => (
              <tr key={k as string} className="border-b border-line/50">
                <td className="py-1.5 text-white/55">{k}</td>
                <td className="py-1.5 text-right mono text-white/85 whitespace-nowrap">
                  {fmtInt(v as number)} <span className="text-white/35">{pct(v as number)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10.5px] text-white/40 mt-1.5">of {fmtInt(a.buildings)} buildings in {areaName}. Click any building for its own screen.</div>
        {a.flood_spots.length > 0 && (
          <div className="mt-2.5">
            <Label>PUB flood-prone locations here</Label>
            <ul className="mt-1 space-y-0.5">
              {a.flood_spots.map((s) => (
                <li key={typeof s === "number" ? s : s.sn} className="text-[11px] text-white/70 leading-snug">
                  · {typeof s === "number" ? `PUB list #${s}` : s.location}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <details className="text-[10.5px] text-white/45 leading-relaxed">
        <summary className="cursor-pointer flex items-center gap-1.5 text-white/60 hover:text-white">
          <Info size={11} /> Sources & limits
        </summary>
        <ul className="mt-1.5 space-y-1">
          {Object.entries(sources).map(([k, v]) => (
            <li key={k}>
              <span className="text-white/60 capitalize">{k.replace("_", " ")}:</span> {v}
            </li>
          ))}
          {CAVEATS.map((c) => (
            <li key={c} className="text-white/40">
              — {c}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
