import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createDevProxy } from './devProxy.js'

const serverRoot = fileURLToPath(new URL('../server/', import.meta.url))

export default defineConfig(({ mode }) => {
  // Read only the server port for development routing. No server credentials
  // are returned in client config or exposed through a VITE_* variable.
  const { PORT } = loadEnv(mode, serverRoot, 'PORT')
  const port = Number(PORT) || 4000
  const gateway = createDevProxy({ target: `http://127.0.0.1:${port}` })
  return {
    plugins: [react(), gateway.plugin],
    server: {
      proxy: gateway.proxy,
    },
  }
})
