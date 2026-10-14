import { execFileSync } from 'node:child_process';
import { verifyLocalTarget, container } from './local-db-target.mjs';
verifyLocalTarget();
// Only this verified disposable project; the explicit network is required on every reset.
let resetFailed = false;
try { execFileSync('./node_modules/.bin/supabase', ['db', 'reset', '--local', '--no-seed', '--network-id', 'tripcast-local-net'], { stdio: 'pipe' }); } catch { resetFailed = true; }
try { verifyLocalTarget(); } catch (error) {
  // The container identity was verified before reset. Fail closed if recreation exposes it.
  const labels = JSON.parse(execFileSync('docker', ['inspect', container, '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
  if (labels['com.supabase.cli.project'] === 'tripcast-local') execFileSync('docker', ['stop', container], { stdio: 'pipe' });
  throw error;
}
if (resetFailed) throw new Error('Local reset failed; network isolation was verified. CLI output suppressed to protect local credentials.');
console.log('Verified TripCast-only local database reset and migration replay completed.');
