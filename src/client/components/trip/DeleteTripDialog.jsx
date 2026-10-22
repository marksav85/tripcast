import { useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '../ui/alert-dialog';

/** The caller retains the revision-aware mutation and removes this control after success. */
export default function DeleteTripDialog({
  title,
  onConfirm,
  disabled,
  errorMessage,
  onDeletedFocus,
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState('');
  const inFlight = useRef(false);
  const active = useRef(false);
  const trigger = useRef(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function changeOpen(next) {
    if (inFlight.current) return;
    if (next) {
      setAttempted(false);
      setFailure('');
    }
    setOpen(next);
  }
  async function confirm(event) {
    // Keep the dialog open for the existing mutation's pending and error states.
    event.preventDefault();
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setPending(true);
    setAttempted(true);
    setFailure('');
    try {
      await onConfirm();
    } catch {
      if (active.current) setFailure('Could not delete your trip. Please try again.');
    } finally {
      inFlight.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="trip-button trip-button-delete"
          disabled={disabled}
        >
          Delete Trip
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (inFlight.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
          else onDeletedFocus?.();
        }}
      >
        <p className="tripcast-alert-eyebrow">Permanent action</p>
        <AlertDialogTitle className="tripcast-alert-title">Delete this trip?</AlertDialogTitle>
        <AlertDialogDescription className="tripcast-alert-description">
          “{title}” will be permanently deleted. This cannot be undone. Any local edits will also be
          discarded.
        </AlertDialogDescription>
        {pending && (
          <output className="trip-notice" aria-live="polite">
            Deleting trip…
          </output>
        )}
        {!pending && attempted && (failure || errorMessage) && (
          <p role="alert" className="trip-notice trip-notice-error">
            {failure || errorMessage}
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
              disabled={pending || disabled}
              onClick={confirm}
            >
              {pending ? 'Deleting…' : 'Delete Trip'}
            </button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
