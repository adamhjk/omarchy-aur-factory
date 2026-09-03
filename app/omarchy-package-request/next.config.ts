import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Dev-server access from the tailnet (e.g. http://espresso:3000).
  allowedDevOrigins: ["espresso", "*.ts.net"],
}

export default nextConfig
