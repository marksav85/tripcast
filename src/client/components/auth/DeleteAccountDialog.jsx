import { useId, useRef, useState } from 'react';
import { finishAccountDeletion, clearDeletedAccountStorage } from '../../auth/deletedAccount.js';
import { authStorageKey } from '../../api/supabase.js';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '../ui/alert-dialog';

export default function DeleteAccountDialog({
  client,
  disabled,
  onBusyChange,
  onDeleted,
  clearState,
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  function changeOpen(next) {
    if (busy.current) return;
    setOpen(next);
    setConfirmation('');
    setError('');
  }
  async function remove(event) {
    event.preventDefault();
    if (busy.current || disabled || confirmation !== 'DELETE') return;
    busy.current = true;
    setPending(true);
    setError('');
    onBusyChange?.(true);
    let confirmed = false;
    try {
      const session = await client.auth.getSession();
      if (session.error || !session.data?.session?.access_token) throw new Error();
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      if (!response.ok || (await response.json()).deleted !== true) throw new Error();
      confirmed = true;
      await finishAccountDeletion(client, {
        clearState,
        navigate: onDeleted,
        clearStorage: () => clearDeletedAccountStorage(authStorageKey),
      });
    } catch {
      if (!confirmed)
        setError(
          'Account deletion could not be confirmed. Your session has been kept. Please try again or contact the site owner.',
        );
    } finally {
      busy.current = false;
      setPending(false);
      onBusyChange?.(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <button type="button" className="shell-action shell-delete-account" disabled={disabled}>
          Delete account
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (busy.current) event.preventDefault();
        }}
      >
        <AlertDialogTitle className="tripcast-alert-title">Delete your account?</AlertDialogTitle>
        <AlertDialogDescription className="tripcast-alert-description">
          Your account and saved trip will be permanently removed. This cannot be undone.
        </AlertDialogDescription>
        <label htmlFor={id}>Type DELETE to confirm</label>
        <input
          id={id}
          className="home-input"
          autoComplete="off"
          value={confirmation}
          disabled={pending}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        {pending && <output aria-live="polite">Deleting account…</output>}
        {error && (
          <p role="alert" className="trip-notice trip-notice-error">
            {error}
          </p>
        )}
        <div className="tripcast-alert-actions">
          <AlertDialogCancel asChild>
            <button type="button" className="trip-button" disabled={pending}>
              Cancel
            </button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <button
              type="button"
              className="trip-button trip-button-destructive"
              onClick={remove}
              disabled={pending || disabled || confirmation !== 'DELETE'}
            >
              {pending ? 'Deleting…' : 'Permanently delete account'}
            </button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
