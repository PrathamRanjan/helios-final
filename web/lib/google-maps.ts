import { GOOGLE_MAPS_KEY } from "./client-api";

declare global {
  interface Window {
    __gmapsLoading?: Promise<any>;
    google: any;
  }
}

/**
 * Load the Google Maps JS API (v=alpha for 3D), idempotent.
 * Includes the maps3d and places libraries.
 */
export function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject("ssr");
  if (window.google && window.google.maps) {
    return Promise.resolve(window.google);
  }
  if (window.__gmapsLoading) return window.__gmapsLoading;

  window.__gmapsLoading = new Promise((resolve, reject) => {
    const callbackName = "__gmapsReady";
    (window as any)[callbackName] = () => {
      resolve(window.google);
      delete (window as any)[callbackName];
    };
    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}` +
      `&v=alpha&libraries=maps3d,places,marker,geometry` +
      `&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("maps failed to load"));
    document.head.appendChild(script);
  });
  return window.__gmapsLoading;
}

export async function importMaps3D() {
  const g = await loadGoogleMaps();
  // The maps3d library exposes Map3DElement and Polygon3DElement etc.
  return (g.maps as any).importLibrary("maps3d") as Promise<{
    Map3DElement: any;
    Polygon3DElement: any;
    Marker3DElement: any;
    Marker3DInteractiveElement: any;
    AltitudeMode: any;
  }>;
}

export async function importPlaces() {
  const g = await loadGoogleMaps();
  return (g.maps as any).importLibrary("places") as Promise<any>;
}
