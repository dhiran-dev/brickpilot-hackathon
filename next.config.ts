import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // reference/ holds the old MVP blueprint — never build or lint it
  outputFileTracingExcludes: {
    "*": ["./reference/**/*", "./docs/**/*"],
  },
};

export default nextConfig;
