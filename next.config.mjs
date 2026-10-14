/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  serverExternalPackages: ["@neondatabase/serverless"],
  // The newsroom writer skill is read from disk at run time (lib/newsroom-skill.ts).
  outputFileTracingIncludes: { "/api/newsroom/draft": ["./skills/**/*"] },
}

export default nextConfig
