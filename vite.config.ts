import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Allow using `scripts/deploy-new.out.env` directly as `frontend-react/.env`.
  // Keep this list tight to avoid accidentally exposing secrets to the browser.
  envPrefix: [
    'VITE_',
    'NODE_',
    'CHAIN_',
    'DEPLOYER_',
    'PAIR_',
    'FACTORY_',
    'ROUTER_',
    'WCSPR_',
    'ECTO_',
    'USDC_',
    'WETH_',
    'WBTC_',
    'SCSPR_',
    'STAKING_',
  ],
  server: {
    proxy: {
      '/rpc': {
        target: 'http://65.21.235.122:7777',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    target: 'esnext' // Important for BigInt support
  }
})
