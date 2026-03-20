import { mount } from 'svelte'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
  props: {
    windowLabel: getCurrentWindow().label,
  },
})

export default app
