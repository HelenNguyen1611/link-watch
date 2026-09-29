import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",            // build ra thư mục out/ để đưa lên S3 + CloudFront
  trailingSlash: true,         // /links/ -> /links/index.html
  images: { unoptimized: true },
  transpilePackages: ["@linkwatch/core"],
};

export default nextConfig;
