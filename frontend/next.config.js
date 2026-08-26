/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Docker Compose injects http://dsa:8000.  Local `next dev` needs the
    // loopback service instead, so a fresh checkout works without Docker DNS.
    const target = process.env.DSA_INTERNAL_URL || "http://127.0.0.1:8010";
    return [
      { source: "/dsa", destination: `${target}/` },
      { source: "/dsa/:path*", destination: `${target}/:path*` }
    ];
  }
};

module.exports = nextConfig;
