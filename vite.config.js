import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import path from "node:path";

const resolveCommit = () => {
  const envSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
  if (envSha) return envSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return "dev";
  }
};
const buildVersion = resolveCommit();
const buildTime = new Date().toISOString();
const tmpBase = process.env.TMPDIR || "/tmp";
const viteCacheDir = path.join(tmpBase, "lifetrack-vite-cache");
const localOutDir = path.join(tmpBase, "lifetrack-dist");
const isCI = Boolean(process.env.CI || process.env.VERCEL);

export default defineConfig({
  cacheDir: viteCacheDir,
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react()],
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore']
  },
  build: {
    sourcemap: true,
    outDir: isCI ? "dist" : localOutDir,
    emptyOutDir: true,
  },
  // Leave CommonJS handling to Vite defaults.
  // Restricting include to /firebase/ can break React named exports in prod build.
})
