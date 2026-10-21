import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from 'vite';
import { SECURITY_HEADERS } from '../../src/worker/security.js';

const origin = 'https://oowesugpxxzvyvfqqxlu.supabase.co';
const wrangler = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));

describe('portfolio deployment configuration', () => {
  it('pins hosted JWT settings and keeps local fixtures isolated', () => {
    for (const vars of [wrangler.vars, wrangler.env.production.vars]) {
      expect(vars).toMatchObject({ STAGE: 'production', MOCK_PROVIDER: 'false',
        SUPABASE_JWT_ISSUER: `${origin}/auth/v1`,
        SUPABASE_JWKS_URL: `${origin}/auth/v1/.well-known/jwks.json`,
        SUPABASE_JWT_AUDIENCE: 'authenticated', SUPABASE_JWT_ALGORITHMS: 'ES256' });
      expect(vars).not.toHaveProperty('OPENWEATHER_API_KEY');
    }
    expect(wrangler.env.local.vars).toEqual({ STAGE: 'local', MOCK_PROVIDER: 'true' });
    expect(wrangler.env.production.routes).toEqual([
      { pattern: 'tripcast.marksavilledesigns.com', custom_domain: true },
    ]);
    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.preview_urls).toBe(false);
  });

  it('serves matching narrow CSP for assets and Worker responses', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'];
    expect(readFileSync('public/_headers', 'utf8')).toContain(`Content-Security-Policy: ${csp}`);
    const directives = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0])
      .map(([name, ...sources]) => [name, sources]));
    expect(directives['connect-src']).toEqual(["'self'", origin]);
    expect(directives['style-src']).toEqual(["'self'", 'https://fonts.googleapis.com']);
    expect(directives['font-src']).toEqual(["'self'", 'https://fonts.gstatic.com']);
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(csp).not.toContain('unsafe-eval');
  });

  it('rejects local URLs and missing or privileged keys in production builds', async () => {
    const previousUrl = process.env.VITE_SUPABASE_URL;
    const previousKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    try {
      for (const [url, key] of [
        ['http://127.0.0.1:54321', 'sb_publishable_configuration_test_only'],
        [origin, ''], [origin, 'sb_secret_configuration_test_only'],
      ]) {
        process.env.VITE_SUPABASE_URL = url;
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY = key;
        await expect(resolveConfig({ logLevel: 'silent' }, 'build', 'production')).rejects.toThrow('Production build requires');
      }
      process.env.VITE_SUPABASE_URL = origin;
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_configuration_test_only';
      const config = await resolveConfig({ logLevel: 'silent' }, 'build', 'production');
      expect(config.env.VITE_SUPABASE_URL).toBe(origin);
      expect(config.env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    } finally {
      for (const [name, value] of [['VITE_SUPABASE_URL', previousUrl], ['VITE_SUPABASE_PUBLISHABLE_KEY', previousKey]]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});
