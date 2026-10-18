"use client";

import { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";

interface Props {
  beforeSrc: string;
  afterSrc: string;
  label?: string;
}

export default function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  label,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, []);

  const update = (clientX: number) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    setPos(pct);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl glass-strong overflow-hidden mt-3 relative select-none"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-white/60 font-medium">
          {label ?? "Before / After"}
        </div>
        <div className="text-[10px] text-white/40 uppercase tracking-wider">
          Drag to reveal
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative w-full aspect-[16/10] cursor-ew-resize overflow-hidden"
        onMouseDown={(e) => {
          dragging.current = true;
          update(e.clientX);
        }}
        onMouseMove={(e) => dragging.current && update(e.clientX)}
        onTouchStart={(e) => {
          dragging.current = true;
          update(e.touches[0].clientX);
        }}
        onTouchMove={(e) => dragging.current && update(e.touches[0].clientX)}
      >
        {/* AFTER (full, behind) */}
        <img
          src={afterSrc}
          alt="after"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* BEFORE (clipped) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${pos}%` }}
        >
          <img
            src={beforeSrc}
            alt="before"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ width: `${(100 / Math.max(pos, 0.001)) * 100}%` }}
          />
        </div>

        {/* Divider */}
        <div
          className="absolute top-0 bottom-0"
          style={{ left: `calc(${pos}% - 1px)` }}
        >
          <div className="w-[2px] h-full bg-white/90 shadow-[0_0_18px_rgba(255,255,255,0.65)]" />
          <div className="absolute top-1/2 -translate-y-1/2 -left-4 w-9 h-9 rounded-full bg-white/95 backdrop-blur flex items-center justify-center shadow-glow">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-bg" fill="currentColor">
              <path d="M8 6l-6 6 6 6V6zm8 0v12l6-6-6-6z" />
            </svg>
          </div>
        </div>

        {/* Labels */}
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/55 backdrop-blur text-[10px] uppercase tracking-wider text-white/85">
          Before
        </div>
        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-solar-400/85 text-bg text-[10px] font-semibold uppercase tracking-wider">
          With HELIO
        </div>
      </div>
    </motion.div>
  );
}