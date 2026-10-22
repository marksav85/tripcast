import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from '../auth/config.js';

const configuration = readSupabaseConfig(import.meta.env);
export const authStorageKey = configuration.config
  ? `sb-${new URL(configuration.config.url).hostname.split('.')[0]}-auth-token`
  : null;
let client = null;
let error = configuration.error;
if (configuration.config) {
  try {
    client = createClient(configuration.config.url, configuration.config.publishableKey, {
      auth: {
        storageKey: authStorageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  } catch {
    error = 'Authentication is unavailable. Please try again later.';
  }
}
// Module singleton; SDK owns persistence and refresh. Explicit callbacks are handled by AuthProvider.
export const supabase = client;
export const authConfigurationError = error;
