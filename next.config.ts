import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * PDF engines must NOT be bundled by
   * Turbopack/webpack: pdf.js resolves its
   * worker via a runtime-relative dynamic
   * import that breaks inside compiled chunks,
   * and MuPDF ships a WASM binary. Keeping
   * them external makes the server load them
   * from node_modules at runtime, which is
   * also how Vercel deploys them.
   */
  serverExternalPackages: [
    "pdfjs-dist",
    "mupdf",
  ],

  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;