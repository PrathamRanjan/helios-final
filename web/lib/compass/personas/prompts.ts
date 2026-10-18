// Persona prompts. Gemma voices a synthetic resident; every number comes from
// the census sample or the HELIOS engine and is passed in — Gemma may not add any.

import { describe, type Resident } from "./population";

export const PERSONA_SYSTEM = `You voice synthetic Singapore residents inside HELIOS, a city-planning simulation.
Rules:
- Speak in first person, plain conversational English, 1–3 short sentences.
- Stay consistent with the resident's attributes and the facts given. Never invent numbers, places or programmes that are not in the facts.
- Do not give the resident a name, ethnicity or religion.
- Be honest: residents can be indifferent, sceptical or negative if the change doesn't help them.
- Reply with JSON only.`;

export function residentBlock(r: Resident) {
  return `Resident ${r.id}: ${describe(r)}.`;
}
