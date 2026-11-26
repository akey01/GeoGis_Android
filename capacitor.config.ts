export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    url?: string;
    cleartext?: boolean;
    androidScheme?: string;
    allowNavigation?: string[];
  };
  plugins?: Record<string, unknown>;
}

const config: CapacitorConfig = {
  appId: 'com.geogis6.mobile',
  appName: 'GeoGIS6 Mobile',
  webDir: 'out',
  server: {
    // Offline-first static bundle from Next.js `out/` (server.url intentionally omitted)
    androidScheme: 'https',
    allowNavigation: [
      '*.onrender.com',
      'geogis6-android.onrender.com',
      'geotransformer-monolith-fniu.onrender.com',
      'github.com',
      '*.githubusercontent.com',
    ],
  },
  plugins: {
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
    },
  },
};

export default config;
