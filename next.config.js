/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // The worker/ directory is a separate Node.js package (Fly.io process).
  // It is excluded from Next.js/TypeScript compilation via tsconfig.json
  // "exclude": ["node_modules", "worker"].
  // No additional webpack config is needed: next build only processes files
  // that TypeScript resolves, and worker/ is excluded from the TS project.
};

module.exports = nextConfig;
