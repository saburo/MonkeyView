import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  base: './',
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  build: {
    target: ['es2022', 'safari13'],
  },
})
