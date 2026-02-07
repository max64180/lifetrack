import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore']
  },
  // Leave CommonJS handling to Vite defaults.
  // Restricting include to /firebase/ can break React named exports in prod build.
})
