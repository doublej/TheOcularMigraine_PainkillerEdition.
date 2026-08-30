import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ocularmigraine.mcp',
  appName: 'The Ocular Migraine',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#1C1E22',
    allowMixedContent: true,
  },
}

export default config
