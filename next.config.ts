import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "oracledb",
    "pg",
    "mysql2",
    "mongodb",
    "bcryptjs",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
    // Cache the RSC tree for already-visited pages so back-navigation feels
    // instant (no server round-trip). Defaults are dynamic=0 / static=300,
    // which forces a fresh RSC fetch on every visit to a dynamic page —
    // that's what was making the sidebar feel like it "keeps loading."
    //
    //   dynamic: 30s   — recently-visited dynamic page is served from
    //                    client cache; revisits skip the loading state.
    //   static: 180s   — static segments stay cached longer.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
