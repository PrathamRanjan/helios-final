"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface Props {
  videoUrl: string;
  onClose: () => void;
}

export default function AerialFlyby({ videoUrl, onClose }: Props) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="relative w-[min(960px,92vw)] aspect-video"
          onClick={(e) => e.stopPropagation()}
        >
          <video
            src={videoUrl}
            autoPlay
            controls
            playsInline
            className="w-full h-full rounded-2xl shadow-panel"
          />
          <button
            onClick={onClose}
            className="absolute -top-4 -right-4 w-10 h-10 rounded-full glass-strong flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="absolute -bottom-9 left-0 text-[11px] text-white/50 font-mono">
            Google Aerial View · pre-rendered 3D flyby
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}