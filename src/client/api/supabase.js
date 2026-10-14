import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from '../auth/config.js';

const configuration = readSupabaseConfig(import.meta.env);
let client = null;
let error = configuration.error;
if (configuration.config) {
  try {
    client = createClient(configuration.config.url, configuration.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  } catch { error = 'Authentication is unavailable. Please try again later.'; }
}
// Module singleton; SDK owns persistence and refresh. Callback flows belong to P2-3B.
export const supabase = client;
export const authConfigurationError = error;
