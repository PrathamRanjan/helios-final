import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IndiaSolar from "@/components/india/IndiaSolar";
import { indiaCityBySlug } from "@/lib/india/cities";
export function generateMetadata({ params }: { params: { city: string } }): Metadata {
  const city = indiaCityBySlug(params.city);
  return { title: city ? `HELIO ${city.name} — Rooftop Solar` : "HELIO — City not found" };
}
export default function IndiaCityPage({ params }: { params: { city: string } }) {
  const city = indiaCityBySlug(params.city);
  if (!city) notFound();
  return <IndiaSolar key={city.slug} city={city} />;
}
