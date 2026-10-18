"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { streamProposal } from "@/lib/client-api";
import type { SolarData } from "@/types";
import { Sparkles, Loader2 } from "lucide-react";

interface Props {
  solar: SolarData;
  slug?: string;
  onClose?: () => void;
}

export default function ProposalStream({ solar, slug }: Props) {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setText("");
    setDone(false);
    setError(null);
    streamProposal({
      slug,
      solar,
      signal: ctrl.signal,
      onToken: (t) => {
        if (!cancelled) setText((prev) => prev + t);
      },
    })
      .then(() => !cancelled && setDone(true))
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setDone(true);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [solar, slug]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="rounded-2xl glass-strong p-5 mt-3 relative overflow-hidden"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="relative">
          <Sparkles className="w-4 h-4 text-solar-400" />
          {!done && (
            <div className="absolute inset-0 sun-glow opacity-80" />
          )}
        </div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-white/60 font-medium">
          Investor Proposal
        </div>
        {!done ? (
          <Loader2 className="w-3 h-3 ml-auto text-solar-400 animate-spin" />
        ) : (
          <div className="ml-auto text-[10px] text-emerald-400/80 uppercase tracking-wider">
            Generated
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="prose-solar max-h-[44vh] overflow-y-auto scroll-clean pr-1"
      >
        {error && (
          <div className="text-rose-400 text-sm mb-2">
            Proposal error: {error}
          </div>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {text || "_Connecting to Gemini 2.5 Flash…_"}
        </ReactMarkdown>
        {!done && text && (
          <span className="inline-block w-2 h-4 bg-solar-400 align-middle animate-pulse ml-0.5" />
        )}
      </div>
    </motion.div>
  );
}