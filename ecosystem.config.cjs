module.exports = {
  apps: [{
    name: 'mantis',
    script: 'npx',
    args: 'next start -p 3001',
    cwd: '/home/degenleaks/Mantle/mantis',
    env: {
      ANTHROPIC_API_KEY: 'sk-WKtaVoT2H2jvhb5Mi61PJeAIsDwEvBGgEUotNhBFCURtU',
      ANTHROPIC_BASE_URL: 'http://localhost:8317/v1',
      MANTLE_RPC_URL: 'https://rpc.mantle.xyz',
      EXECUTION_MODE: 'execute',
    },
  }],
};
