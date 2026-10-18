// Haze physics for the simulator. Transboundary smoke haze (Kalimantan / Sumatra fires
// in SEA; crop burning, traffic and dust in India) can't be switched off by a city plan —
// but its effects on people and assets are modellable:
//
//   • outdoor active travel falls on haze days (people avoid walking/cycling outside);
//     enclosed modes (MRT, bus, car) are unaffected, so shade/shelters DON'T cushion haze
//   • rooftop PV yield drops on haze days (aerosols cut irradiance)
//
// Sources:
//   PSI ↔ PM2.5 breakpoints: NEA PSI sub-index bands (24-h PM2.5, µg/m³).
//   Cycling response: −7.0% (shared) to −15.6% (private) bike trips per +10 µg/m³ PM2.5
//     (panel study of 24 urban zones; TRID 2709590). Walking assumed half as sensitive.
//   PV loss: 15–25% yield loss in the June 2013 Singapore haze (Nobre et al., Renewable
//     Energy 2016); 2% annual insolation loss at Singapore background PM2.5 (Peters et al.,
//     Energy Environ. Sci. 2018).

/** NEA PSI → 24-h PM2.5 (µg/m³), piecewise linear on the sub-index breakpoints. */
const PSI_PM25: [number, number][] = [
  [0, 0],
  [50, 12],
  [100, 55],
  [200, 150],
  [300, 250],
  [400, 350],
  [500, 500],
];

export function psiToPm25(psi: number): number {
  const p = Math.max(0, Math.min(500, psi));
  for (let i = 1; i < PSI_PM25.length; i++) {
    const [x0, y0] = PSI_PM25[i - 1];
    const [x1, y1] = PSI_PM25[i];
    if (p <= x1) return y0 + ((p - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 500;
}

/** NEA health-advisory band for a 24-h PSI. */
export function psiBand(psi: number): "Good" | "Moderate" | "Unhealthy" | "Very unhealthy" | "Hazardous" {
  return psi <= 50 ? "Good" : psi <= 100 ? "Moderate" : psi <= 200 ? "Unhealthy" : psi <= 300 ? "Very unhealthy" : "Hazardous";
}

const BACKGROUND_PM25 = 15; // typical clean-day 24-h PM2.5 in Singapore (µg/m³)
const CYCLE_DROP_PER_10UG = 0.11; // midpoint of 7.0–15.6% per +10 µg/m³
const MAX_ACTIVE_DROP = 0.8; // nobody stops travelling entirely; trips move to enclosed modes
const PV_LOSS_AT_VERY_UNHEALTHY = 0.2; // midpoint of 15–25% (2013 event, PSI peak 401)

export interface HazeEffect {
  pm25: number;
  /** Share of cycling trips lost on a haze day (walking: half). */
  cycleDropOnHazeDay: number;
  /** Fraction of PV yield lost on a haze day. */
  pvLossOnHazeDay: number;
  /** Annualised: share of the year affected. */
  dayShare: number;
}

export function hazeEffect(psi: number, daysPerYear: number): HazeEffect {
  const pm25 = psiToPm25(psi);
  const excess = Math.max(0, pm25 - BACKGROUND_PM25);
  const cycleDrop = Math.min(MAX_ACTIVE_DROP, (excess / 10) * CYCLE_DROP_PER_10UG);
  const pvLoss = Math.min(0.35, PV_LOSS_AT_VERY_UNHEALTHY * (excess / (psiToPm25(250) - BACKGROUND_PM25)));
  return { pm25, cycleDropOnHazeDay: cycleDrop, pvLossOnHazeDay: pvLoss, dayShare: Math.max(0, Math.min(365, daysPerYear)) / 365 };
}
