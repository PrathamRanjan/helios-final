// Small planar-approx geometry helpers for modifier targeting.
// At Singapore's latitude (~1.3°N) treating lat/lng as planar with a cos(lat)
// correction is accurate to well under 1% over district scales.

const KM_PER_DEG_LAT = 111.32;

function kmPerDegLng(lat: number): number {
  return KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Distance in km between two [lng, lat] points (planar approximation). */
export function distKm(a: [number, number], b: [number, number]): number {
  const midLat = (a[1] + b[1]) / 2;
  const dx = (a[0] - b[0]) * kmPerDegLng(midLat);
  const dy = (a[1] - b[1]) * KM_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance in km from point p to segment [a, b] (all [lng, lat]). */
export function pointToSegmentKm(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const midLat = (a[1] + b[1] + p[1]) / 3;
  const kx = kmPerDegLng(midLat);
  const px = p[0] * kx, py = p[1] * KM_PER_DEG_LAT;
  const ax = a[0] * kx, ay = a[1] * KM_PER_DEG_LAT;
  const bx = b[0] * kx, by = b[1] * KM_PER_DEG_LAT;
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/** Distance in km from point p to a polyline. */
export function pointToPolylineKm(p: [number, number], line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, pointToSegmentKm(p, line[i], line[i + 1]));
  }
  return line.length === 1 ? distKm(p, line[0]) : best;
}

/** Ray-casting point-in-polygon on the outer ring ([lng, lat]). */
export function pointInPolygon(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Length of a polyline in km. */
export function polylineLengthKm(line: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += distKm(line[i], line[i + 1]);
  return total;
}
