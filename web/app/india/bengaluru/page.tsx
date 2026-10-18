import type { Metadata } from "next";
import BengaluruSolar from "@/components/india/BengaluruSolar";

export const metadata: Metadata = { title: "HELIO Bengaluru — Rooftop Solar", description: "Explore Bengaluru rooftop solar potential using Google Solar API, with transparent INR financial scenarios." };

export default function BengaluruSolarPage() {
  return <BengaluruSolar />;
}
