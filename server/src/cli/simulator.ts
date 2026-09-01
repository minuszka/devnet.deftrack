import { runSimulatorCli } from './simulatorClient.js';

runSimulatorCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`simulator: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
