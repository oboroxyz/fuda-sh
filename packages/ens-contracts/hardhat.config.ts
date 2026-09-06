import { defineConfig } from 'hardhat/config'

export default defineConfig({
  solidity: {
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
    version: '0.8.28',
  },
})
