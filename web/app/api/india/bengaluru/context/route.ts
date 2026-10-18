import { NextRequest } from "next/server";
import { getContext } from "@/lib/india/server";
import { BENGALURU } from "@/lib/india/cities";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(req: NextRequest) { return getContext(req, BENGALURU); }
