import type { NextConfig } from "next";

// Next.js 16 explicitly rejects a bare "*" as an allowedDevOrigin
// (see node_modules/next/dist/server/app-render/csrf-protection.js).
// To effectively allow any origin we enumerate multi-segment wildcards
// that cover IPv4 addresses and any-label hostnames, plus common tunnel
// providers. This keeps HMR working from LAN IP, public IP, custom
// domains and tunnels during development.
const nextConfig: NextConfig = {
  allowedDevOrigins: [
    // any IPv4 address (LAN, public, NAT)
    "*.*.*.*",
    // any 2..6 label hostname (example.com, foo.example.com, a.b.c.d.e.f)
    "*.*",
    "*.*.*",
    "*.*.*.*",
    "*.*.*.*.*",
    "*.*.*.*.*.*",
    // common tunnel providers
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
    "*.loca.lt",
    "*.lhr.life",
  ],
};

export default nextConfig;
