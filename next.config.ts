import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * A production build writes into its own directory so it cannot clobber the
   * build cache a running dev server is serving from. Sharing one directory
   * leaves the dev server handing out 404s for chunks it no longer has, which
   * looks exactly like a broken page: markup renders, hydration never happens,
   * and nothing appears in the console except two missing files.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default config;
