import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Allow an isolated local test server alongside an existing development app.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs", "exceljs"],
  // Conditional ESM exports used by ExcelJS dependencies must ship in standalone.
  outputFileTracingIncludes: {
    "/api/export": [
      "./node_modules/generator-function/**/*",
      "./node_modules/async-function/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
