"use client";

import { motion } from "framer-motion";
import { Mountain, Clock, Wind, Cloud, Film } from "lucide-react";
import type { ContextData } from "@/types";

interface Props {
  context: ContextData | null;
  onPlayAerial?: () => void;
}

export default function ContextStrip({ context, onPlayAerial }: Props) {
  if (!context) return null;
  const { elevation, timezone, air_quality, weather, aerial_view } = context;

  const chips: Array<{ icon: JSX.Element; label: string; value: string; tone?: string; title?: string }> = [];
  if (elevation) {
    chips.push({
      icon: <Mountain className="w-3 h-3" />,
      label: "Elevation",
      value: `${elevation.elevation_m} m`,
      title: `Site elevation above sea level · resolution ±${elevation.resolution_m} m (Google Elevation API)`,
    });
  }
  if (timezone) {
    chips.push({
      icon: <Clock className="w-3 h-3" />,
      label: "Solar noon",
      value: timezone.solar_noon_local,
      title: `Local solar noon in ${timezone.time_zone_id} (UTC+${timezone.utc_offset_hours})`,
    });
  }
  if (air_quality) {
    const tone = aqiTone(air_quality.aqi);
    chips.push({
      icon: <Wind className="w-3 h-3" />,
      label: `AQI · ${air_quality.dominant_pollutant.toUpperCase()}`,
      value: String(air_quality.aqi),
      tone,
      title: `${air_quality.category} (Google Universal AQI · dominant pollutant ${air_quality.dominant_pollutant})`,
    });
  }
  if (weather) {
    chips.push({
      icon: <Cloud className="w-3 h-3" />,
      label: weather.description,
      value: `${Math.round(weather.temp_c)}°C`,
      title: `Now: ${weather.description}, feels like ${Math.round(weather.feels_like_c)}°C · cloud cover ${weather.cloud_cover_pct ?? "—"}% (Google Weather API)`,
    });
  }

  if (chips.length === 0 && !aerial_view) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.55, duration: 0.5 }}
      className="mt-3 flex flex-wrap gap-1.5"
    >
      {chips.map((c, i) => (
        <span
          key={i}
          title={c.title}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] ${c.tone ?? "bg-white/[0.04] text-white/70 border border-white/[0.04]"}`}
        >
          <span className="opacity-65">{c.icon}</span>
          <span className="text-white/45">{c.label}</span>
          <span className="font-mono text-white">{c.value}</span>
        </span>
      ))}
      {aerial_view && onPlayAerial && (
        <button
          onClick={onPlayAerial}
          title="Play pre-rendered Google Aerial View cinematic flyby"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] bg-solar-400/15 text-solar-200 hover:bg-solar-400/25 transition-colors border border-solar-400/30"
        >
          <Film className="w-3 h-3" />
          <span>Cinematic flyby</span>
        </button>
      )}
    </motion.div>
  );
}

function aqiTone(aqi: number): string {
  // Google Universal AQI: 0–100, higher is BETTER (inverse of US AQI)
  if (aqi >= 80) return "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30";
  if (aqi >= 60) return "bg-emerald-500/10 text-emerald-200/90 border border-emerald-500/20";
  if (aqi >= 40) return "bg-solar-400/15 text-solar-200 border border-solar-400/30";
  return "bg-rose-500/15 text-rose-200 border border-rose-500/30";
}