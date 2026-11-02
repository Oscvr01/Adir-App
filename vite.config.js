import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5174,
    proxy: {
      '/api.php': {
        target: 'https://adirgestion.app',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  esbuild: {
    // Elimina console.* y debugger en el bundle de producción.
    // console.error y console.warn se conservan para diagnóstico real.
    drop: ['debugger'],
    pure: ['console.log', 'console.info', 'console.debug'],
  },
})
