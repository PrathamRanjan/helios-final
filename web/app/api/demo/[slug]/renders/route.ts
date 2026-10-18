import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const RENDERS_DIR = path.join(process.cwd(), "public", "renders");

export async function GET(_req: Request, ctx: { params: { slug: string } }) {
  const slug = ctx.params.slug;
  const before = path.join(RENDERS_DIR, `${slug}-before.png`);
  const after = path.join(RENDERS_DIR, `${slug}-after.png`);
  const [b, a] = await Promise.all([
    fs.access(before).then(() => true).catch(() => false),
    fs.access(after).then(() => true).catch(() => false),
  ]);
  return NextResponse.json({
    before: b ? `/renders/${slug}-before.png` : null,
    after: a ? `/renders/${slug}-after.png` : null,
  });
}
