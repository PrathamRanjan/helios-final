// The Open Stack: why HELIOS exists. Each sustainability product category, what the
// paid version costs, what HELIOS does instead from open data, and where paying is
// still justified. Counters are computed from the data on disk, not typed in.

import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Unlock, Lock } from "lucide-react";
import { Wordmark } from "@/components/v2/ui";
import { CAPABILITIES, DATASETS, MOATS, THESIS } from "@/lib/compass/openStack";
import { RULES } from "@/lib/compass/compliance/rules";

export const metadata = { title: "HELIOS — Open Stack" };

async function counts() {
  const dir = path.join(process.cwd(), "data", "sg");
  const read = async (p: string) => {
    try {
      return JSON.parse(await fs.readFile(path.join(dir, p), "utf-8"));
    } catch {
      return null;
    }
  };
  const [nat, bld] = await Promise.all([read("nature/buildings.json"), read("buildings.json")]);
  return {
    screened: nat?.n ?? null,
    bca: bld?.buildings?.length ?? null,
    measured: bld ? bld.buildings.filter((b: any) => b.gfa_m2 && Object.keys(b.eui ?? {}).length).length : null,
    rules: RULES.length,
    examples: RULES.reduce((s, r) => s + (r.examples?.length ?? 0), 0),
    datasets: Object.keys(DATASETS).length,
  };
}

const n = (x: number | null) => (x == null ? "—" : x.toLocaleString("en-SG"));

export default async function OpenStackPage() {
  const c = await counts();
  const built = CAPABILITIES.filter((x) => x.status === "built").length;
  return (
    <main className="v2 min-h-screen v2-grid-bg">
      <header className="sticky top-0 z-50 h-12 flex items-center gap-3 px-3 border-b border-line bg-ink-0/90 backdrop-blur">
        <Wordmark />
        <span className="h-5 w-px bg-line" />
        <Link href="/sg" className="v2-btn !h-7"><ArrowLeft size={12} /> World</Link>
        <span className="text-[12px] text-white/70">Open stack</span>
      </header>

      <div className="max-w-[1180px] mx-auto px-4 py-10 space-y-10">
        <section className="space-y-4 max-w-[760px]">
          <div className="mono text-[10.5px] uppercase tracking-[0.18em] text-signal-300">Why HELIOS exists</div>
          <h1 className="text-[30px] sm:text-[38px] leading-[1.1] text-white">Data is the moat. The rest should be free.</h1>
          <p className="text-[15px] text-white/65 leading-relaxed">{THESIS}</p>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-[4px] overflow-hidden">
          {[
            [n(c.screened), "buildings screened for nature, flood and heat"],
            [n(c.measured), `buildings with measured Scope 2 (of ${n(c.bca)} BCA-listed)`],
            [`${c.rules} · ${c.examples}`, "cited rules · worked examples run as tests"],
            [`${c.datasets} · S$0`, "open data sources · licence cost"],
          ].map(([v, l]) => (
            <div key={l} className="bg-ink-1 p-4">
              <div className="mono text-[22px] text-white">{v}</div>
              <div className="text-[11.5px] text-white/50 mt-1 leading-snug">{l}</div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-[18px] text-white">What HELIOS replaces</h2>
            <span className="text-[11.5px] text-white/45">{built} built · {CAPABILITIES.length - built} screening-grade · prices are list where published, otherwise third-party (labelled)</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {CAPABILITIES.map((cap) => (
              <article key={cap.id} className="v2-panel p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] text-white">{cap.name}</h3>
                  <span className={`mono shrink-0 rounded-[3px] border px-1.5 text-[9.5px] uppercase tracking-wider ${cap.status === "built" ? "border-signal-400/40 text-signal-300" : "border-warn-400/40 text-warn-300"}`}>
                    {cap.status === "built" ? "built" : "screening-grade"}
                  </span>
                </div>
                <p className="text-[12.5px] text-white/65 leading-snug">{cap.what}</p>
                <div className="space-y-1">
                  {cap.replaces.map((r) => (
                    <div key={r.vendor} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="flex items-center gap-1.5 text-white/55 min-w-0">
                        <Lock size={11} className="shrink-0 text-white/30" />
                        <span className="truncate">{r.vendor}</span>
                      </span>
                      <span className="mono text-white/70 shrink-0">
                        {r.source ? <a href={r.source} target="_blank" rel="noreferrer" className="hover:text-white underline decoration-white/20">{r.price}</a> : r.price}
                        {r.basis === "third_party" && <span className="text-white/30"> ³ᵖ</span>}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-1.5 text-signal-300">
                      <Unlock size={11} /> HELIOS
                    </span>
                    <span className="mono text-signal-300">S$0 data · {cap.datasets.length} open sources</span>
                  </div>
                </div>
                <div className="text-[11px] text-white/40 leading-snug">
                  {cap.datasets.map((d) => DATASETS[d]?.publisher).filter((v, i, a) => v && a.indexOf(v) === i).join(" · ")}
                </div>
                <div className="text-[11px] text-white/45 leading-snug border-t border-line pt-2">
                  <span className="text-white/60">Still worth paying for:</span> {cap.out_of_reach}
                </div>
                <Link href={cap.where.href} className="mt-auto inline-flex items-center gap-1 text-[12px] text-signal-300 hover:text-signal-200">
                  Open in HELIOS · {cap.where.label} <ArrowUpRight size={12} />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[18px] text-white">Where we still say: pay someone</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {MOATS.map((m) => (
              <div key={m.name} className="rounded-[4px] border border-line p-3">
                <div className="text-[13px] text-white">{m.name}</div>
                <p className="text-[11.5px] text-white/50 mt-1 leading-snug">{m.why}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[18px] text-white">Every source, every licence</h2>
          <div className="overflow-x-auto v2-panel">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="text-left text-white/40 mono text-[10px] uppercase tracking-wider">
                  <th className="px-3 py-2 font-normal">Dataset</th>
                  <th className="px-3 py-2 font-normal">Publisher</th>
                  <th className="px-3 py-2 font-normal">Licence</th>
                  <th className="px-3 py-2 font-normal">Refreshed by</th>
                  <th className="px-3 py-2 font-normal">Used for</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(DATASETS).map(([id, d]) => (
                  <tr key={id} className="border-t border-line/60">
                    <td className="px-3 py-2 text-white/80">
                      <a href={d.url} target="_blank" rel="noreferrer" className="hover:text-white">{d.name}</a>
                    </td>
                    <td className="px-3 py-2 text-white/60">{d.publisher}</td>
                    <td className="px-3 py-2 text-white/55">{d.licence}</td>
                    <td className="px-3 py-2 mono text-[11px] text-white/45">{d.refresh}</td>
                    <td className="px-3 py-2 text-white/45">{CAPABILITIES.filter((cap) => cap.datasets.includes(id)).map((cap) => cap.name.split(" (")[0]).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-white/35">Vendor prices change and many are quote-only; third-party figures are directional. HELIOS outputs are screening and policy-alignment indicators, not legal, engineering or assurance opinions.</p>
        </section>
      </div>
    </main>
  );
}
