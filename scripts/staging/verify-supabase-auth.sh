#!/usr/bin/env bash
(
  read -rsp 'Staging publishable key: ' TC_KEY; printf '\n'
  read -rsp 'User A email: ' TC_EMAIL; printf '\n'
  read -rsp 'User A password: ' TC_PASSWORD; printf '\n'
  export TC_KEY TC_EMAIL TC_PASSWORD

  node --input-type=module <<'JS'
import { createClient } from '@supabase/supabase-js';

const url = 'https://oowesugpxxzvyvfqqxlu.supabase.co';
const key = process.env.TC_KEY;
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

function check(name, passed) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  if (!passed) throw new Error('CHECK_FAILED');
}

let client;
let signedIn = false;
let failed = false;

try {
  check('Publishable API key', Boolean(key?.startsWith('sb_publishable_')));
  client = createClient(url, key, options);

  const { data, error } = await client.auth.signInWithPassword({
    email: process.env.TC_EMAIL,
    password: process.env.TC_PASSWORD,
  });
  signedIn = Boolean(data?.session);
  check('Email/password sign-in', !error && Boolean(data?.user));
  check('Authenticated session exists', signedIn);

  const parts = data.session.access_token.split('.');
  const decode = value =>
    JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  const header = decode(parts[0]);
  const claims = decode(parts[1]);

  check('JWT algorithm is ES256', header.alg === 'ES256');
  check('JWT issuer matches staging', claims.iss === `${url}/auth/v1`);
  check('JWT audience includes authenticated',
    [claims.aud].flat().includes('authenticated'));

  const result = await client.from('trips').select('*');
  check('Authenticated SELECT succeeds with empty list',
    !result.error && Array.isArray(result.data) && result.data.length === 0);

  const anonymous = createClient(url, key, options);
  const denied = await anonymous.from('trips').select('*');
  check('Unauthenticated SELECT is denied by privileges',
    Boolean(denied.error) &&
    [401, 403].includes(denied.status) &&
    denied.error.code === '42501');
} catch {
  console.log('STOP: check failed or request unavailable; details suppressed.');
  failed = true;
} finally {
  if (signedIn) {
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      check('Sign-out succeeds', !error);
    } catch {
      console.log('FAIL: sign-out');
      failed = true;
    }
  }
}
process.exitCode = failed ? 1 : 0;
JS
)