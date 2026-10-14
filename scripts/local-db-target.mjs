import { execFileSync } from 'node:child_process';
import { realpathSync, readFileSync } from 'node:fs';
export const container = 'supabase_db_tripcast-local';
export function verifyLocalTarget() {
  const config = readFileSync('supabase/config.toml', 'utf8');
  if (!/^project_id = "tripcast-local"$/m.test(config)) throw new Error('Unexpected local project identifier.');
  const rows = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }));
  const c = rows[0]; const labels = c.Config.Labels;
  if (labels['com.supabase.cli.project'] !== 'tripcast-local'
    || realpathSync(labels['com.supabase.cli.workdir']) !== realpathSync('.')
    || !c.Mounts.some((m) => m.Name === 'supabase_db_tripcast-local' && m.Destination === '/var/lib/postgresql/data')
    || !c.State.Running) throw new Error('Disposable database identity check failed.');
  const network = JSON.parse(execFileSync('docker', ['network', 'inspect', 'tripcast-local-net'], { encoding: 'utf8' }))[0];
  if (network.Options?.['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1'
    || network.Labels?.['com.tripcast.scope'] !== 'disposable-local') throw new Error('Unexpected isolated network configuration.');
  const ids = execFileSync('docker', ['ps', '-q', '--filter', 'label=com.supabase.cli.project=tripcast-local'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const all = ids.length ? JSON.parse(execFileSync('docker', ['inspect', ...ids], { encoding: 'utf8' })) : [];
  if (all.some((instance) => !instance.NetworkSettings.Networks['tripcast-local-net'])) throw new Error('Project container outside isolated network.');
  for (const instance of all) for (const bindings of Object.values(instance.NetworkSettings.Ports ?? {})) {
    for (const binding of bindings ?? []) if (!['127.0.0.1', '::1'].includes(binding.HostIp)) throw new Error('Non-loopback service binding.');
  }
  const name = execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'select current_database();'], { encoding: 'utf8' }).trim();
  if (name !== 'postgres') throw new Error('Unexpected database name.');
  return container;
}
