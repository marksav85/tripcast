const unavailable = {
  config: null,
  error: 'Authentication is unavailable. Check the public Supabase configuration.',
};

// Public configuration only. Reject legacy JWTs and privileged sb_secret keys.
export function readSupabaseConfig(env) {
  const urlValue = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (
    typeof urlValue !== 'string' ||
    urlValue !== urlValue.trim() ||
    typeof key !== 'string' ||
    !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)
  )
    return unavailable;
  try {
    const url = new URL(urlValue);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
      return unavailable;
    if (
      env.DEV
        ? url.origin !== 'http://127.0.0.1:54321'
        : url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      return unavailable;
    return { config: { url: url.origin, publishableKey: key }, error: null };
  } catch {
    return unavailable;
  }
}
