import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@streaming/core", "@streaming/types"],
  serverExternalPackages: ["@streaming/transcoder"],
};

export default nextConfig;
