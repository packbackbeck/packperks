import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamp the build time at compile time so the deployed app can show which
// version is live (set when Vercel builds; dev-server start time locally).
const BUILD_TIME = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
})
