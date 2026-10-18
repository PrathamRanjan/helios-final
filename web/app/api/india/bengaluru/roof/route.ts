import { NextRequest } from "next/server";
import { postRoof } from "@/lib/india/server";
import { BENGALURU } from "@/lib/india/cities";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(req: NextRequest) { return postRoof(req, BENGALURU); }
