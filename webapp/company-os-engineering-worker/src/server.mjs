import { loadConfig } from './config.mjs';
import { EngineeringDaemon } from './daemon.mjs';

async function main() {
  const daemon = new EngineeringDaemon({ config: loadConfig() });
  const shutdown = async () => { await daemon.stop(); process.exit(0); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  await daemon.start();
  process.stdout.write(JSON.stringify({ event: 'ENGINEERING_V2_RUNNER_READY', health: '127.0.0.1' }) + '\n');
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ event: 'ENGINEERING_V2_RUNNER_FAILED', code: error?.code || 'STARTUP_FAILED' }) + '\n');
  process.exitCode = 1;
});
