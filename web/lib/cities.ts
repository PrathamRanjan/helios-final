// Single source of truth for Mission Control destinations. Used by Mission Control
// (the globe hub), the in-module CityRail switcher, and the transition overlay.
// Camera fields are hand-tuned cinematic framings (cosmetic only — no data).

export type CityCode = "SG" | "TH" | "VN" | "IN";

export interface City {
  code: CityCode;
  label: string;
  flag: string;
  country: string;
  center: { lat: number; lng: number };
  tilt: number;
  heading: number;
  range: number; // arrival range (metres); smaller = closer
  route: string;
  lever: string; // the climate lever this city demonstrates
  hook: string; // one-line description of the module
  proves: string; // what it proves for ASEAN coverage
  accent: string; // tailwind text colour
}

export const CITIES: City[] = [
  {
    code: "SG",
    label: "Singapore",
    flag: "🇸🇬",
    country: "Singapore",
    center: { lat: 1.2921, lng: 103.8519 },
    tilt: 58, heading: 20, range: 1700,
    route: "/sg",
    lever: "Low-carbon mobility",
    hook: "Find where Singapore should act across 55 planning areas, simulate changes 2026–2036, and check them against Green Mark, VES and EV rules.",
    proves: "Full decision engine — mode-shift, lifecycle carbon, finance, back-test",
    accent: "text-solar-300",
  },
  {
    code: "TH",
    label: "Bangkok",
    flag: "🇹🇭",
    country: "Thailand",
    center: { lat: 13.7466, lng: 100.5389 },
    tilt: 56, heading: 30, range: 1700,
    route: "/bangkok",
    lever: "Rooftop solar",
    hook: "Click any rooftop for a 60-second solar pre-feasibility report — live Google Solar API coverage.",
    proves: "Real per-building solar data (Thailand has Solar API coverage)",
    accent: "text-emerald-300",
  },
  {
    code: "VN",
    label: "Hanoi",
    flag: "🇻🇳",
    country: "Vietnam",
    center: { lat: 21.0285, lng: 105.8542 },
    tilt: 57, heading: 15, range: 1700,
    route: "/hanoi",
    lever: "EV × coal grid",
    hook: "Site smart-charging hubs that shift 450k+ e-scooters off the evening coal peak into midday solar.",
    proves: "Grid-carbon load-shifting where there's no Solar API coverage",
    accent: "text-sky-300",
  },
  {
    code: "IN", label: "India", flag: "🇮🇳", country: "India",
    center: { lat: 22.5, lng: 79 }, tilt: 0, heading: 0, range: 3600000,
    route: "/india", lever: "Urban sandbox + solar · 8 cities",
    hook: "Experiment with shade, cool roofs and water scenarios across eight Indian cities, or explore rooftop solar.",
    proves: "Shared urban sustainability sandbox and rooftop solar, with explicit assumptions",
    accent: "text-solar-300",
  },
];

export function cityByCode(code: string): City | undefined {
  return CITIES.find((c) => c.code === code);
}
