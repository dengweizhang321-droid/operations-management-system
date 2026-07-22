import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep the development runtime's multipart limit aligned with the
    // netshop import route (25 MiB). Without this, Vinext rejects valid JD
    // daily workbooks at its default 1 MiB Server Action limit before the
    // route can apply its own validation.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
