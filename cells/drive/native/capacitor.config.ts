import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: process.env.DRIVE_IOS_BUNDLE_ID ?? 'land.parc.drive',
  appName: 'Drive',
  webDir: 'dist/web',
  backgroundColor: '#05070c',
  server: {
    hostname: 'localhost',
    iosScheme: 'capacitor',
  },
  ios: {
    contentInset: 'always',
    preferredContentMode: 'mobile',
  },
  plugins: {
    // Cell/auth endpoints do not expose broad WebView CORS. The native bridge
    // keeps TLS validation while moving those requests outside WKWebView CORS.
    CapacitorHttp: {
      enabled: true,
    },
    Browser: {
      presentationStyle: 'popover',
    },
  },
};

export default config;
