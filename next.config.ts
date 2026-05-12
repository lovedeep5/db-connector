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
  },
};

export default nextConfig;
