import { NextRequest } from "next/server";
import { getSolar } from "@/lib/india/server";
import { BENGALURU } from "@/lib/india/cities";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) { return getSolar(req, BENGALURU); }
