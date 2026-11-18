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
}

const config: CapacitorConfig = {
  appId: 'com.geogis6.android',
  appName: 'GeoGIS6 Mobile',
  webDir: 'public',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      '*.onrender.com',
      'geogis6-android.onrender.com',
      'geotransformer-monolith-fniu.onrender.com',
    ],
  },
};

export default config;
