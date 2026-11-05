import type { NextConfig } from "next";

// Defence-in-depth headers. The app has no login, so it must never be framed by another
// site (clickjacking an "Approve all" button) or leak URLs through the Referer header.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["mammoth", "@prisma/client", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
    // The request guard (src/middleware.ts) sees every request. Without this, Next cuts request
    // bodies to 10 MB when middleware runs, which silently broke uploads between 10 and 25 MB.
    middlewareClientMaxBodySize: "30mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
