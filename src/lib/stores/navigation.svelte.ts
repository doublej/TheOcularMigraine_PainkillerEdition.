export type Tab = 'tune' | 'recording' | 'system'

/** 1 where the app is running, 2 how to set that route up, 3 what actually works, 4 done. */
export type SetupStep = 1 | 2 | 3 | 4

let activeTab = $state<Tab>('tune')
let setupStep = $state<SetupStep | null>(null)

export function getActiveTab() {
  return activeTab
}

export function setActiveTab(tab: Tab) {
  activeTab = tab
}

/** The wizard's step, or null when it is closed. */
export function getSetupOpen(): SetupStep | null {
  return setupStep
}

export function openSetup(step: SetupStep = 1) {
  setupStep = step
}

export function closeSetup() {
  setupStep = null
}
