import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/700.css'
import './app.css'
import App from './App.svelte'
import { mount } from 'svelte'

const app = mount(App, { target: document.getElementById('app')! })

export default app
