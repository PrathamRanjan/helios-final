"use client";

// A sleek intro.js-driven walkthrough for the (admittedly complex) HELIO Flow
// sandbox. Auto-runs once on first visit; a floating "?" pill re-launches it.
// Steps attach to the real UI via [data-tour="…"] anchors on the page.

import { useCallback, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import introJs from "intro.js";
import "intro.js/introjs.css";

const SEEN_KEY = "helio-flow-tour-seen";

const STEPS = [
  {
    title: "Welcome to HELIO Flow",
    intro:
      "This is a <b>living model of a city</b>, not a dashboard. Draw a change, and thousands of simulated residents re-decide how they travel — carbon, cost and heat all move in response. 60 seconds and you'll know the whole thing.",
  },
  {
    element: '[data-tour="layers"]',
    title: "The four lenses",
    intro:
      "Four ways to read the same city:<br/><b>👁 Flows</b> — where people actually travel today.<br/><b>🚶 Agents</b> — the live residents, moving.<br/><b>⚡ EV zones</b> — where charging should go.<br/><b>🔥 Heat</b> — how hot each street is to walk.<br/>Change one thing and the others react — that's the engine.",
  },
  {
    element: '[data-tour="draw"]',
    title: "Make a change",
    intro:
      "Drop a <b>point</b> (a charger, a solar canopy), draw a <b>line</b> (a shaded cycle corridor), or a <b>zone</b>. You then declare what it does — HELIO turns it into a real world-change the agents feel.",
  },
  {
    element: '[data-tour="clock"]',
    title: "The time machine",
    intro:
      "Everything plays out <b>2026 → 2036</b>. Hit play and watch adoption ramp, the grid clean up, and your intervention pay off (or not) year by year.",
  },
  {
    element: '[data-tour="decide"]',
    title: "Decide — don't just look",
    intro:
      "This is the point of it all. Every scenario ends in a verdict: <b>Fund · Study · Defer</b>. We check it isn't a bad trade (a fix that makes something else worse), back-test it against real built projects, and show cost-per-tonne. Then <b>✨ Suggest changes</b> asks the AI to spend a budget for you.",
  },
  {
    title: "You're set",
    intro:
      "That's the loop: <b>draw → simulate → decide → act</b>. Bottom-right you'll find <b>Legend</b> (what every term means), <b>Agents</b> (the AI system under the hood), and a <b>Live feed</b> of events you can inject. Re-open this tour any time with <b>Tour</b>.",
  },
];

export default function TourButton({ inline = false }: { inline?: boolean }) {
  const startTour = useCallback(() => {
    const tour = introJs();
    tour.setOptions({
      steps: STEPS,
      tooltipClass: "helio-tour",
      highlightClass: "helio-tour-highlight",
      showProgress: true,
      showBullets: false,
      exitOnOverlayClick: false,
      scrollToElement: true,
      overlayOpacity: 0.55,
      nextLabel: "Next →",
      prevLabel: "← Back",
      doneLabel: "Start exploring",
    });
    tour.start();
  }, []);

  // Auto-run once, after the page has settled so anchors exist.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(SEEN_KEY)) return;
    if (new URLSearchParams(window.location.search).get("tour") === "off") return; // demo / screenshot links
    const t = setTimeout(() => {
      startTour();
      localStorage.setItem(SEEN_KEY, "1");
    }, 900);
    return () => clearTimeout(t);
  }, [startTour]);

  return (
    <button
      onClick={startTour}
      title="Take the guided tour"
      className={inline ? "v2-btn" : "fixed bottom-5 right-5 z-50 flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-[12px] text-white/80 hover:text-white transition-colors shadow-panel"}
    >
      <HelpCircle size={15} className="text-solar-300" />
      Tour
    </button>
  );
}
