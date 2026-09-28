// pm2 configuration. Start with: pm2 startOrReload deploy/ecosystem.config.cjs
//
// Server settings (PORT, ALLOWED_ORIGINS, …) live in `.env` next to
// package.json, written once by deploy/cloudpanel-setup.sh. That file is not
// in git and deploys never overwrite it. See .env.example for all options.
//
// IMPORTANT: exactly ONE instance in fork mode. Rooms live in the memory of
// the process; cluster mode would spread players over processes that do not
// know each other's rooms.
module.exports = {
  apps: [
    {
      name: 'timons-arcade',
      script: 'server/index.js',
      cwd: __dirname + '/..',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      kill_timeout: 6000, // the server needs up to 5 s for a graceful shutdown
      restart_delay: 1000,
      time: true, // timestamps in pm2 logs
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
