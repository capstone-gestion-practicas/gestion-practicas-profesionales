import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cl.practicalink.app',
  appName: 'PracticaLink',
  webDir: 'dist/practicalink-frontend/browser',
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert', 'banner', 'list']
    }
  }
};

export default config;
