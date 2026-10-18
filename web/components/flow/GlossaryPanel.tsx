"use client";

// The "I'm lost" button. HELIO Flow is dense, so this is a slide-out legend +
// dictionary: what each map lens means, what every metric means, and what the
// decision terms mean. Purely explanatory — no state touched.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, X, Eye, PersonStanding, Zap, Flame } from "lucide-react";

const LENSES = [
  { icon: Eye, tint: "text-white/70", name: "Flows", def: "Thin arcs = real fare-card trips between corridors. Thicker = more people travel it today. This is demand." },
  { icon: PersonStanding, tint: "text-solar-200", name: "Agents", def: "The moving cars/buses/trains/people. Their mix follows the simulated year's mode share — scrub time and the street population changes. This is behaviour." },
  { icon: Zap, tint: "text-sky-300", name: "EV zones", def: "HELIO-recommended charging pins. Click one to drop it into the world. This is opportunity." },
  { icon: Flame, tint: "text-rose-300", name: "Heat", def: "Corridors shaded by how hot they are to walk (darker = hotter, from OSM building shadows). This is climate stress." },
];

const METRICS = [
  ["Cumulative CO₂ avoided (t)", "Tonnes of CO₂ your change removes vs the do-nothing baseline, summed 2026–2036. The headline impact number."],
  ["Cost per tonne ($/t)", "Capex ÷ CO₂ avoided. Compare to the carbon tax (~$60–80/t in SG by 2030) — under it = cheaper than the penalty."],
  ["Confidence band (P10–P90)", "Monte-Carlo range: run the sim many times with sampled inputs; 80% of runs land in this band. Wide = uncertain."],
  ["Heat exposure reduced (%)", "Drop in person-km of active travel exposed to heat — the comfort/accessibility co-benefit."],
  ["Grid headroom / band", "Screening estimate of added electrical load vs rule-of-thumb thresholds. 'Review' / 'substation' = needs a utility load study. A proxy, not a power-flow model."],
  ["Mode share", "The % split of trips across car / bus / MRT / walk / cycle. Interventions shift it — that shift is where carbon moves."],
];

const DECISION = [
  ["Fund · Study · Defer", "The verdict. Fund = act now; Study = promising but needs a load/feasibility check; Defer = doesn't clear the bar."],
  ["Regrettable substitution", "A fix that just moves the problem — emits more to build than it ever saves, with no co-benefit. HELIO rejects these."],
  ["Pareto frontier", "The set of options where nothing beats them on carbon, heat AND cost at once. The recommendation sits on it."],
  ["Back-test", "The engine re-run against real built projects (Ang Mo Kio cycling, TransJakarta) to check it predicts the right direction."],
  ["Embodied vs operational carbon", "Embodied = CO₂ to manufacture/build. Operational = CO₂ saved in use. Net avoided = operational − embodied."],
  ["Confidence tiers", "Every number is tagged: measured · literature-derived · calibrated proxy · speculative · policy pathway. Honesty as a feature."],
];

export default function GlossaryPanel({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Legend & glossary"
        className={inline ? "v2-btn" : "fixed bottom-5 right-[88px] z-50 flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-[12px] text-white/80 hover:text-white transition-colors shadow-panel"}
      >
        <BookOpen size={15} className="text-sky-300" />
        Legend
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] bg-black/50"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ x: 380 }} animate={{ x: 0 }} exit={{ x: 380 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed top-0 right-0 h-full w-[360px] max-w-full z-[71] bg-[#0f1117] border-l border-white/10 shadow-panel overflow-y-auto"
            >
              <div className="sticky top-0 bg-[#0f1117]/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between">
                <span className="font-display text-sm text-solar-gradient">Legend &amp; glossary</span>
                <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white p-1"><X size={16} /></button>
              </div>

              <div className="p-4 space-y-5">
                <Group title="The four map lenses">
                  {LENSES.map((l) => {
                    const Icon = l.icon;
                    return (
                      <div key={l.name} className="flex gap-2.5">
                        <Icon size={15} className={`${l.tint} mt-0.5 shrink-0`} />
                        <div>
                          <div className="text-[12px] text-white/85 font-medium">{l.name}</div>
                          <div className="text-[11px] text-white/55 leading-snug">{l.def}</div>
                        </div>
                      </div>
                    );
                  })}
                </Group>

                <Group title="Metrics">
                  {METRICS.map(([t, d]) => <Term key={t} t={t} d={d} />)}
                </Group>

                <Group title="Decision terms">
                  {DECISION.map(([t, d]) => <Term key={t} t={t} d={d} />)}
                </Group>

                <div className="text-[10px] text-white/35 leading-snug border-t border-white/10 pt-3">
                  The lenses interact: heat suppresses walking → pushes people to cars → changes flows → changes CO₂. Change one thing and the others react. That interaction is the product.
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{title}</div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Term({ t, d }: { t: string; d: string }) {
  return (
    <div>
      <div className="text-[12px] text-white/85 font-medium">{t}</div>
      <div className="text-[11px] text-white/55 leading-snug">{d}</div>
    </div>
  );
}
