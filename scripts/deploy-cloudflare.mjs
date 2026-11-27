import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyRepositoryConfig } from './verify-cloudflare-deployment.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const options = { cwd, stdio: 'inherit' };

try {
  if (process.argv.length > 2) {
    throw new Error('deploy:cloudflare does not accept Wrangler arguments; it uses wrangler.jsonc');
  }
  const { wrangler } = verifyRepositoryConfig(cwd);
  execFileSync(process.execPath, ['scripts/write-deployment-metadata.mjs', '--verify'], options);
  // Use a shell for npx.cmd on Windows. No caller arguments reach this command.
  execSync(`npx --yes wrangler@${wrangler} deploy --config wrangler.jsonc`, options);
} catch (error) {
  console.error(error.message);
  process.exitCode = error.status || 1;
}
