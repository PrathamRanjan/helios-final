import type { Metadata } from "next";
import IndiaExplorer from "@/components/india/IndiaExplorer";
export const metadata: Metadata = {
  title: "HELIOS India — Urban Sandbox & Solar",
  description: "Test urban sustainability scenarios or explore rooftop solar across eight Indian cities, with explicit assumptions and INR financials.",
};
export default function IndiaPage() { return <IndiaExplorer />; }
