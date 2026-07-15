import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // reference/ holds the old MVP blueprint — never build or lint it
  outputFileTracingExcludes: {
    "*": ["./reference/**/*", "./docs/**/*"],
  },
};

export default nextConfig;
