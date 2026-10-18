export interface Bounds { south: number; north: number; west: number; east: number }
export interface RoofPoint { lat: number; lng: number }

export function withinBounds(bounds: Bounds, lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

/** Validate a small roof ring before computing its spherical area; shared by UI and API. */
export function roofPolygon(input: unknown, bounds: Bounds): { areaM2: number; center: RoofPoint } {
  if (!Array.isArray(input) || input.length < 3 || input.length > 100) throw new Error('Draw between 3 and 100 roof corners.');
  const points: RoofPoint[] = input.map(p => {
    if (!p || !withinBounds(bounds, p.lat, p.lng)) throw new Error('Every corner must be inside the selected city.');
    return {lat:p.lat,lng:p.lng};
  });
  if (new Set(points.map(p=>`${p.lat}:${p.lng}`)).size !== points.length) throw new Error('Remove duplicate roof corners.');
  const center = {lat:points.reduce((n,p)=>n+p.lat,0)/points.length,lng:points.reduce((n,p)=>n+p.lng,0)/points.length};
  const cross = (a:RoofPoint,b:RoofPoint,c:RoofPoint) => (b.lng-a.lng)*(c.lat-a.lat)-(b.lat-a.lat)*(c.lng-a.lng);
  const on = (a:RoofPoint,b:RoofPoint,p:RoofPoint) => Math.abs(cross(a,b,p)) < 1e-14 && p.lat >= Math.min(a.lat,b.lat) && p.lat <= Math.max(a.lat,b.lat) && p.lng >= Math.min(a.lng,b.lng) && p.lng <= Math.max(a.lng,b.lng);
  for (let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    for (let j=i+1;j<points.length;j++) {
      if (j===i+1 || (i===0 && j===points.length-1)) continue;
      const c=points[j],d=points[(j+1)%points.length];
      if ((cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b)) throw new Error('Roof edges cross or touch. Draw the corners in order.');
    }
  }
  // Translate first to avoid cancellation from large absolute longitude/latitude values.
  const planarDoubleArea = Math.abs(points.reduce((sum,a,i) => {
    const b=points[(i+1)%points.length];
    return sum+(a.lng-center.lng)*(b.lat-center.lat)-(b.lng-center.lng)*(a.lat-center.lat);
  },0));
  if (planarDoubleArea < 1e-12) throw new Error('Roof corners must enclose an area, not a straight line.');
  const rad=Math.PI/180;
  const areaM2=Math.abs(points.reduce((sum,a,i)=>{
    const b=points[(i+1)%points.length];
    return sum+(b.lng-a.lng)*rad*(Math.sin(a.lat*rad)+Math.sin(b.lat*rad));
  },0))*6378137**2/2;
  if (!Number.isFinite(areaM2) || areaM2<2.6 || areaM2>100000) throw new Error('Draw a roof between 2.6 and 100,000 m².');
  return {areaM2,center};
}
