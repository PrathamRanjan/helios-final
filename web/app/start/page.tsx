"use client";

// The first screen — deliberately ONE user, one decision (per the judges'
// "nail the specific user" note: unfocused 68 → focused 86). We build for the
// city / transport planner. Bangkok solar and Hanoi EV are NOT co-equal doors;
// they're shown subordinate as "same engine, other levers" — scale + revenue
// proof, not a persona fork the judge has to choose between.

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Globe2, MapPin } from "lucide-react";

const OTHER_LEVERS = [
  {
    flag: "🇹🇭",
    city: "Bangkok",
    lever: "Rooftop solar",
    note: "B2C — the cash-flow line",
    route: "/bangkok",
    accent: "text-emerald-300",
  },
  {
    flag: "🇻🇳",
    city: "Hanoi",
    lever: "EV × coal grid",
    note: "B2G2B — state-funded charging",
    route: "/hanoi",
    accent: "text-sky-300",
  },
];

export default function StartPage() {
  const router = useRouter();

  const enterEngine = () => {
    try {
      localStorage.setItem("helio-persona", "planner");
    } catch {}
    router.push("/sg");
  };

  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-bg grain flex flex-col items-center justify-center px-6 py-16">
      <div className="sun-glow pointer-events-none absolute -top-44 left-1/2 -translate-x-1/2 w-[720px] h-[720px] opacity-60" />

      {/* Brand */}
      <div className="absolute top-6 left-6 flex items-center gap-2">
        <Globe2 className="w-5 h-5 text-solar-400" />
        <span className="font-display text-lg text-solar-gradient leading-none">HELIO</span>
      </div>

      {/* ── The one user ── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55 }}
        className="relative z-10 text-center max-w-2xl"
      >
        <div className="inline-flex items-center gap-1.5 text-solar-300/80 text-[11.5px] tracking-[0.22em] uppercase mb-5">
          <MapPin size={13} /> Low-carbon mobility · decision engine
        </div>

        <h1 className="font-display text-4xl md:text-[3.4rem] leading-[1.05] text-white">
          You run a city's<br />
          <span className="text-solar-gradient">mobility budget.</span>
        </h1>

        <p className="text-white/60 text-[14px] md:text-[15px] mt-6 leading-relaxed max-w-xl mx-auto">
          Every year you approve millions in cycle lanes, EV chargers and bus
          upgrades — on gut feel and consultant PDFs that land six months late.
          HELIO turns one intervention into a <b className="text-white/85">live, back-tested
          Fund · Study · Defer decision</b> in 60 seconds.
        </p>

        <motion.button
          onClick={enterEngine}
          whileHover={{ y: -2 }}
          className="btn-solar mt-8 inline-flex items-center gap-2 text-[14px]"
        >
          Enter your decision engine <ArrowRight size={16} />
        </motion.button>

        <div className="text-white/35 text-[11.5px] mt-3">
          Singapore · all 55 planning areas · 2026–2036 — real LTA, census &amp; BCA data
        </div>
      </motion.div>

      {/* ── Same engine, other levers (subordinate) ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="relative z-10 mt-14 w-full max-w-xl"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-white/35 text-[10.5px] tracking-wider uppercase">
            Same engine · other levers · how we fund it
          </span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {OTHER_LEVERS.map((o) => (
            <button
              key={o.city}
              onClick={() => router.push(o.route)}
              className="group glass rounded-xl px-3.5 py-3 flex items-center gap-3 text-left hover:border-white/15 border border-white/8 transition-colors"
            >
              <span className="text-xl">{o.flag}</span>
              <span className="flex flex-col leading-tight">
                <span className="text-[12.5px] text-white/85 font-medium">
                  {o.city} · <span className={o.accent}>{o.lever}</span>
                </span>
                <span className="text-[10.5px] text-white/40">{o.note}</span>
              </span>
              <ArrowRight
                size={13}
                className="ml-auto text-white/25 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all"
              />
            </button>
          ))}
        </div>
        <div className="text-white/28 text-[10.5px] mt-3 text-center">
          One product, one core user — solar &amp; EV are the revenue lines that
          fund the slow government sale.
        </div>
      </motion.div>
    </div>
  );
}
