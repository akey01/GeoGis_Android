import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

/** @type {import('next').NextConfig} */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isApkExport = process.env.NEXT_EXPORT_APK === '1';

const nextConfig = {
  ...(isApkExport ? { output: 'export', trailingSlash: true } : {}),
  images: {
    unoptimized: true,
  },
  // Workspace root para trazado de archivos en producción
  outputFileTracingRoot: __dirname,
  // Permite peticiones cross-origin desde localhost en desarrollo
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Security Headers (only applied in server/SSR mode; omitted during static export)
  ...(isApkExport
    ? {}
    : {
        async headers() {
          return [
            {
              source: '/(.*)',
              headers: [
                { key: 'X-Frame-Options', value: 'DENY' },
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                {
                  key: 'Permissions-Policy',
                  value: 'camera=(self), microphone=(), geolocation=(self)',
                },
                { key: 'X-XSS-Protection', value: '1; mode=block' },
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
                {
                  key: 'Content-Security-Policy',
                  value:
                    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: *.google.com *.gstatic.com *.arcgisonline.com *.arcgis.com; connect-src 'self' *.render.com *.onrender.com *.supabase.co *.google.com *.gstatic.com *.googleapis.com *.arcgisonline.com *.arcgis.com https://api.github.com https://api.open-meteo.com https://api.open-elevation.com;",
                },
              ],
            },
            {
              source: '/wasm/:path(.*\\.wasm)',
              headers: [
                { key: 'Content-Type', value: 'application/wasm' },
                { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
