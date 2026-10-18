"use client";

// Owns the cross-route city-switch transition. Mounted once in the root layout,
// so when a module calls goToCity() the overlay globe plays the swoop, routes to
// the destination mid-arc (so it loads behind the overlay), and fades out once
// the dive lands — a seamless hand-off between two different map engines.

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import TransitionGlobe from "./TransitionGlobe";
import { cityByCode, type City } from "@/lib/cities";

interface Ctx {
  goToCity: (fromCode: string, toCode: string) => void;
  transitioning: boolean;
}

const CityTransitionContext = createContext<Ctx>({ goToCity: () => {}, transitioning: false });
export const useCityTransition = () => useContext(CityTransitionContext);

export default function CityTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [trip, setTrip] = useState<{ from: City; to: City } | null>(null);

  const goToCity = useCallback(
    (fromCode: string, toCode: string) => {
      if (trip) return; // one transition at a time
      const from = cityByCode(fromCode);
      const to = cityByCode(toCode);
      if (!from || !to || from.code === to.code) return;
      router.prefetch?.(to.route);
      setTrip({ from, to });
    },
    [trip, router]
  );

  // Route at the top of the arc so the destination mounts behind the overlay
  // and is painted by the time the dive finishes.
  const handleMidpoint = useCallback(() => {
    setTrip((t) => {
      if (t) router.push(t.to.route);
      return t;
    });
  }, [router]);

  const handleArrive = useCallback(() => {
    setTimeout(() => setTrip(null), 650);
  }, []);

  return (
    <CityTransitionContext.Provider value={{ goToCity, transitioning: !!trip }}>
      {children}
      <AnimatePresence>
        {trip && (
          <motion.div
            key="city-transition"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="fixed inset-0 z-[100] bg-bg"
          >
            <TransitionGlobe from={trip.from} to={trip.to} onMidpoint={handleMidpoint} onArrive={handleArrive} />
            {/* cinematic vignette + destination label */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-bg to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg/95 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
              <div className="glass rounded-full px-4 py-2 text-[12px] text-white/85 flex items-center gap-2">
                <span className="text-base">{trip.to.flag}</span> Flying to {trip.to.label}…
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </CityTransitionContext.Provider>
  );
}
