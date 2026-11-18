export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    url?: string;
    cleartext?: boolean;
    androidScheme?: string;
  };
}

const config: CapacitorConfig = {
  appId: 'com.geogis6.android',
  appName: 'GeoGIS6 Mobile',
  webDir: 'public',
  server: {
    androidScheme: 'https',
  },
};

export default config;
