import type { Metadata } from "next";
import "./globals.css";
import CityTransitionProvider from "@/components/city/CityTransitionProvider";

export const metadata: Metadata = {
  title: "HELIOS — the open sustainability engine for Singapore",
  description:
    "Nature risk, carbon accounting, taxonomy compliance, physical risk, solar feasibility and city simulation for every building in Singapore, built from open data. Every number cited; no paid data licences.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg">
        <CityTransitionProvider>{children}</CityTransitionProvider>
      </body>
    </html>
  );
}
