/** @type {import('next').NextConfig} */
const nextConfig = {
  // Separate build dir lets a production build run next to `next dev`; standalone output for the Cloud Run image.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // The render endpoints return ~3-7MB base64 PNGs. Bump the body size limit.
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // sharp needs Node runtime, not Edge — opt out of Edge globally
  // (individual routes can still set runtime = "edge" if needed)
};

export default nextConfig;
