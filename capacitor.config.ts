import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ocularmigraine.mcp',
  appName: 'The Ocular Migraine',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0a0a0f',
    allowMixedContent: true,
  },
}

export default config
