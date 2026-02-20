import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@collab/shared"],
  serverExternalPackages: ["yjs", "konva"],
};

export default nextConfig;
