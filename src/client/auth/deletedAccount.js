/** Clear only this project's persisted Auth records, including SDK companion keys. */
export function clearDeletedAccountStorage(storageKey) {
  if (!storageKey) return;
  for (const key of [storageKey, `${storageKey}-user`, `${storageKey}-code-verifier`]) {
    window.localStorage.removeItem(key);
  }
}

/** Deletion is already confirmed. SDK/network failures must not turn it into failure. */
export async function finishAccountDeletion(
  client,
  {
    clearState = () => {},
    navigate = () => window.location.replace('/?account=deleted'),
    clearStorage = () => {},
  } = {},
) {
  clearState();
  try {
    await client.auth.stopAutoRefresh?.();
  } catch {
    /* Local cleanup continues. */
  }
  let timer;
  try {
    clearStorage();
    await Promise.race([
      Promise.resolve()
        .then(() => client.auth.signOut({ scope: 'local' }))
        .catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Remove persistence even when getSession/signOut refresh or logout requests fail.
    try {
      clearStorage();
    } finally {
      navigate();
    }
  }
}
