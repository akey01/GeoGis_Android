import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const STAGING = path.join(ROOT, '.apk-export-staging');
const APP_DIR = path.join(ROOT, 'app');

const SERVER_ONLY_ENTRIES = [
  'app/api',
  'app/dashboard',
  'app/login',
  'app/register',
  'proxy.ts',
  'public/wasm',
];

const APK_PAGE_TSX = `'use client';

import React from 'react';
import GeoGis6MobileShell from '@/components/geogis6-mobile/GeoGis6MobileShell';

export default function HomePage() {
  return <GeoGis6MobileShell />;
}
`;

function ensureCleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function moveSafe(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  return true;
}

const movedItems = [];
const pagePath = path.join(APP_DIR, 'page.tsx');
const originalPageContent = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : null;

// Verify production env vars do not point to localhost
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('NEXT_PUBLIC_') && typeof v === 'string' && /localhost|127\.0\.0\.1/i.test(v)) {
    console.error(`[APK Export] ERROR: ${k} apunta a localhost (${v})`);
    process.exit(1);
  }
}

let exitCode = 0;

try {
  ensureCleanDir(STAGING);

  // Clean previous build output
  for (const dir of [path.join(ROOT, 'out'), path.join(ROOT, '.next')]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  // Temporarily isolate server-only routes so Next.js static export (`output: 'export'`) builds cleanly
  for (const rel of SERVER_ONLY_ENTRIES) {
    const src = path.join(ROOT, rel);
    const dst = path.join(STAGING, rel);
    if (moveSafe(src, dst)) {
      movedItems.push({ src, dst });
    }
  }

  // Mount the 5-screen GeoGIS6 Mobile production shell as the sole entry point (app/page.tsx)
  fs.writeFileSync(pagePath, APK_PAGE_TSX, 'utf8');

  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const buildEnv = {
    ...process.env,
    NEXT_EXPORT_APK: '1',
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://geogis6-android.onrender.com',
    NEXT_PUBLIC_APP_PLATFORM: 'android',
    NODE_ENV: 'production',
  };

  console.log('[APK Export] Running Next.js static export (output: "export") -> out/ ...');
  let result = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: ROOT,
    env: buildEnv,
    stdio: 'inherit',
  });

  const outIndex = path.join(ROOT, 'out', 'index.html');
  const exportGenerated = fs.existsSync(outIndex) && fs.statSync(outIndex).size > 2000;

  if (result.status !== 0 && !exportGenerated) {
    exitCode = result.status || 1;
    throw new Error(`Next.js static export failed with exit code ${exitCode}`);
  }

  if (!exportGenerated) {
    exitCode = 1;
    throw new Error('Static export completed but out/index.html was not generated.');
  }
  console.log('[APK Export] Clean static export verified:', outIndex, `(${fs.statSync(outIndex).size} bytes)`);
} catch (err) {
  console.error('[APK Export] Build failed:', err?.message || err);
  if (exitCode === 0) exitCode = 1;
} finally {
  // Always restore server-only files and original app/page.tsx
  if (originalPageContent !== null) {
    fs.writeFileSync(pagePath, originalPageContent, 'utf8');
  }
  for (const item of movedItems.reverse()) {
    moveSafe(item.dst, item.src);
  }
  if (fs.existsSync(STAGING)) {
    fs.rmSync(STAGING, { recursive: true, force: true });
  }
}

process.exit(exitCode);
