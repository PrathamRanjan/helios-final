"use client";

// Bangkok surface — the rooftop / solar pre-feasibility experience, defaulted to
// Thailand where the Google Solar API has real per-building coverage.
import SolarExplorer from "@/components/SolarExplorer";

export default function BangkokPage() {
  return <SolarExplorer initialCountry="TH" />;
}
