import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/http/security-headers";

// The public base origin; when it is a real https host it is allowed as an
// img/media source in the CSP so served audio loads. Read directly from env
// (next.config runs outside the app's getConfig()).
const baseUrl = process.env.APP_BASE_URL?.trim() || undefined;

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply the security headers to every route.
        source: "/:path*",
        headers: securityHeaders(baseUrl),
      },
    ];
  },
};

export default nextConfig;
