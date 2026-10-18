"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { Search, MapPin } from "lucide-react";

interface Props {
  onPick: (t: { lat: number; lng: number; address: string }) => void;
  compact?: boolean;
}

type Suggestion = {
  placeId: string;
  text: string;
  secondary: string;
  raw: any; // PlacePrediction object (new Places API)
};

export default function SearchBar({ onPick, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [preds, setPreds] = useState<Suggestion[]>([]);
  const sessionToken = useRef<any>(null);
  const placesLib = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const g = await loadGoogleMaps();
      // Load the NEW Places library (the modern Places API)
      const places = await (g.maps as any).importLibrary("places");
      placesLib.current = places;
      sessionToken.current = new places.AutocompleteSessionToken();
    })().catch((e) => console.error("places init", e));
  }, []);

  useEffect(() => {
    if (!value || !placesLib.current) {
      setPreds([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const { AutocompleteSuggestion } = placesLib.current;
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value,
          sessionToken: sessionToken.current,
          locationBias: {
            // bias toward SE Asia (centered on Bangkok ~1500km radius)
            radius: 1500000,
            center: { lat: 13.7563, lng: 100.5018 },
          },
        });
        const mapped: Suggestion[] = (suggestions ?? [])
          .filter((s: any) => s.placePrediction)
          .map((s: any) => {
            const p = s.placePrediction;
            return {
              placeId: p.placeId,
              text: p.mainText?.text ?? p.text?.text ?? "",
              secondary: p.secondaryText?.text ?? "",
              raw: p,
            };
          });
        setPreds(mapped);
      } catch (e) {
        console.error("autocomplete error", e);
        setPreds([]);
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [value]);

  const pickPlace = async (s: Suggestion) => {
    try {
      // Convert prediction → Place object, fetch the location field
      const place = s.raw.toPlace();
      await place.fetchFields({
        fields: ["location", "formattedAddress", "displayName"],
      });
      if (!place.location) return;
      const lat = place.location.lat();
      const lng = place.location.lng();
      const address = place.formattedAddress ?? `${s.text}, ${s.secondary}`;
      onPick({ lat, lng, address });
      setValue(address);
      setOpen(false);
      setPreds([]);
      // session token must be refreshed after each pick per Places-New billing
      sessionToken.current = new placesLib.current.AutocompleteSessionToken();
    } catch (e) {
      console.error("place fetch error", e);
    }
  };

  return (
    <div className={`relative ${compact ? "w-[420px]" : "w-[520px]"}`}>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search any rooftop in Southeast Asia…"
          className={`w-full pl-11 pr-4 ${compact ? "py-3 text-sm" : "py-4 text-[15px]"} rounded-2xl glass-strong text-white placeholder:text-white/35 outline-none focus:border-solar-400/40 transition-colors`}
        />
      </div>
      {open && preds.length > 0 && (
        <div className="absolute left-0 right-0 mt-2 rounded-2xl glass-strong overflow-hidden z-30">
          {preds.slice(0, 5).map((s) => (
            <button
              key={s.placeId}
              onClick={() => pickPlace(s)}
              className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04] last:border-0"
            >
              <MapPin className="w-4 h-4 mt-0.5 text-solar-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-white truncate">{s.text}</div>
                <div className="text-[11px] text-white/45 truncate">{s.secondary}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}