import { execFileSync } from 'node:child_process';
import { verifyLocalTarget } from './local-db-target.mjs';
verifyLocalTarget();
execFileSync('./node_modules/.bin/supabase', ['test', 'db', '--network-id', 'tripcast-local-net'], { stdio: 'inherit' });
