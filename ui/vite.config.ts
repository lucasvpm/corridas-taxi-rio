import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em dev, /api é encaminhado para a API local (mesmo comportamento do nginx no container).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
