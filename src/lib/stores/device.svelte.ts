import * as adb from '../bridge/adb'
import type { Mode } from '../bridge/adb'
import * as persistence from './persistence'

export interface DeviceInfo {
  name: string
  model: string
  ip: string
  ssid: string
  signalStrength: number
  battery: number
  charging: boolean
  freeSpace: string
  totalSpace: string
  firmwareVersion: string
}

export interface DisplaySettings {
  resolutionWidth: number
  resolutionHeight: number
  refreshRate: number
  cpuLevel: number
  gpuLevel: number
  ffrLevel: number
  cpuDynamic: boolean
  gpuDynamic: boolean
  ffrDynamic: boolean
}

export interface RecordingSettings {
  width: number
  height: number
  bitrate: number
  framerate: number
  eye: 'left' | 'right' | 'both'
  fovCrop: { up: number; down: number; inward: number; outward: number }
  swapInterval: number
  adaclocks: boolean
}

export interface GameProfile {
  id: string
  name: string
  packageName: string
  display: DisplaySettings
  recording?: RecordingSettings
  isDefault: boolean
}

let device = $state<DeviceInfo>({
  name: 'Quest 3',
  model: 'Meta Quest 3',
  ip: '192.168.1.100',
  ssid: 'HomeNetwork',
  signalStrength: -45,
  battery: 78,
  charging: false,
  freeSpace: '42.3 GB',
  totalSpace: '128 GB',
  firmwareVersion: 'v62.0',
})

const defaultDisplay: DisplaySettings = {
  resolutionWidth: 1832,
  resolutionHeight: 1920,
  refreshRate: 120,
  cpuLevel: 3,
  gpuLevel: 3,
  ffrLevel: 2,
  cpuDynamic: true,
  gpuDynamic: true,
  ffrDynamic: false,
}

const defaultRecording: RecordingSettings = {
  width: 1920,
  height: 1080,
  bitrate: 20000,
  framerate: 60,
  eye: 'left',
  fovCrop: { up: 0, down: 0, inward: 0, outward: 0 },
  swapInterval: 1,
  adaclocks: true,
}

let display = $state<DisplaySettings>(persistence.loadDisplaySettings() ?? { ...defaultDisplay })
let recording = $state<RecordingSettings>(persistence.loadRecordingSettings() ?? { ...defaultRecording })

let profiles = $state<GameProfile[]>([])

let connectionMode = $state<Mode>('mock')
let serverConnected = $state(true)

export function getDevice() { return device }
export function getDisplay() { return display }
export function getRecording() { return recording }
export function getProfiles() { return profiles }
export function getConnectionMode() { return connectionMode }
export function getServerConnected() { return serverConnected }

export function refreshConnectionState() {
  connectionMode = adb.getConnectionMode()
  serverConnected = adb.isServerConnected()
}

export function updateDisplay(patch: Partial<DisplaySettings>) {
  Object.assign(display, patch)
  persistence.saveDisplaySettings(display)
}

export function updateRecording(patch: Partial<RecordingSettings>) {
  Object.assign(recording, patch)
  persistence.saveRecordingSettings(recording)
}

export function addProfile(profile: GameProfile) {
  profiles.push(profile)
}

export function removeProfile(id: string) {
  const idx = profiles.findIndex(p => p.id === id)
  if (idx >= 0) profiles.splice(idx, 1)
}

export async function refreshDevice() {
  const [model, battery, storage, wifi, firmware, displaySettings] = await Promise.all([
    adb.getprop('ro.product.model'),
    adb.getBatteryInfo(),
    adb.getStorageInfo(),
    adb.getWifiInfo(),
    adb.getFirmwareVersion(),
    adb.getCurrentDisplaySettings(),
  ])
  if (model) device.model = model
  device.battery = battery.level
  device.charging = battery.charging
  device.freeSpace = storage.free
  device.totalSpace = storage.total
  if (wifi.ip) device.ip = wifi.ip
  if (wifi.ssid) device.ssid = wifi.ssid
  device.signalStrength = wifi.signal
  if (firmware) device.firmwareVersion = firmware
  Object.assign(display, displaySettings)
  persistence.saveDisplaySettings(display)
  refreshConnectionState()
}
