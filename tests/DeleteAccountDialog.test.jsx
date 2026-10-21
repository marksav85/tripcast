import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DeleteAccountDialog from '../src/client/components/auth/DeleteAccountDialog.jsx';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const client = { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'synthetic' } } }), signOut: vi.fn().mockResolvedValue({}) } };
  const onDeleted = vi.fn();
  render(<DeleteAccountDialog client={client} onDeleted={onDeleted} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  return { client, onDeleted };
}
it('requires exact DELETE and cancels without sending requests', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); setup();
  const action = screen.getByRole('button', { name: 'Permanently delete account' });
  expect(action).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } });
  expect(action).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(fetch).not.toHaveBeenCalled();
});
it('prevents duplicate submissions then clears the session and returns home on success', async () => {
  let finish; const fetch = vi.fn(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetch);
  const { client, onDeleted } = setup();
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  finish(Response.json({ deleted: true }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  const [, options] = fetch.mock.calls[0]; expect(JSON.parse(options.body)).toEqual({ confirmation: 'DELETE' });
});
it('keeps the session and dialog on failure with a sanitized error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private details', { status: 503 })));
  const { client, onDeleted } = setup();
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your session has been kept');
  expect(client.auth.signOut).not.toHaveBeenCalled(); expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).not.toHaveTextContent('private details');
});
it.each(['reject', 'error'])('does not display deletion failure or block navigation when signOut %s', async mode => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ deleted: true })));
  const { client, onDeleted } = setup();
  if (mode === 'reject') client.auth.signOut.mockRejectedValue(new Error('private refresh failure'));
  else client.auth.signOut.mockResolvedValue({ error: new Error('private logout failure') });
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('preserves session when deletion response cannot be parsed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unusable', { status: 200 })));
  const { client, onDeleted } = setup();
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
  expect(client.auth.signOut).not.toHaveBeenCalled(); expect(onDeleted).not.toHaveBeenCalled();
});
