import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/client/context/AuthContextProvider.jsx';
import { useAuth } from '../src/client/auth/context.js';
import { readSupabaseConfig } from '../src/client/auth/config.js';
import App from '../src/client/App.jsx';
import { WeatherProvider } from '../src/client/context/WeatherContextProvider.jsx';
import { deferred, berlin, daySummary } from './fixtures/weather';
import { fetchMock, apiResponse } from './fixtures/api';
import { fireEvent } from '@testing-library/react';
const publicKey = 'sb_publishable_synthetic_test_public_value';
const config = { DEV: true, VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: publicKey };
function Probe() {
  const { status, user, loading, error } = useAuth();
  return <div>{status}|{user?.id ?? 'none'}|{String(loading)}|{error}</div>;
}
function mockClient(promise) {
  let callback;
  const unsubscribe = vi.fn();
  return { auth: { getSession: vi.fn(() => promise), onAuthStateChange: vi.fn((cb) => {
    callback = cb; return { data: { subscription: { unsubscribe } } };
  }) }, emit: (session, event = 'SIGNED_IN') => callback(event, session), unsubscribe };
}
const session = { user: { id: 'owner-a' }, access_token: 'synthetic-do-not-render' };
describe('public configuration', () => {
  it('accepts the exact local origin and a public publishable key', () => expect(readSupabaseConfig(config).config.url).toBe(config.VITE_SUPABASE_URL));
  it.each([
    {}, { VITE_SUPABASE_URL: '' }, { VITE_SUPABASE_URL: 'bad' },
    { VITE_SUPABASE_URL: 'http://localhost:54321' }, { VITE_SUPABASE_URL: 'https://wrong.example' },
    { VITE_SUPABASE_URL: 'http://user:password@127.0.0.1:54321' },
    { VITE_SUPABASE_URL: 'http://127.0.0.1:54321/path' }, { VITE_SUPABASE_URL: 'http://127.0.0.1:54321/?key=x' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: '' }, { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_privileged' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJ.legacy.jwt' },
  ])('rejects malformed or unintended config %#', (override) => {
    const value = Object.keys(override).length ? { ...config, ...override } : {};
    expect(readSupabaseConfig(value).config).toBeNull();
    expect(readSupabaseConfig(value).error).not.toContain('password');
  });
  it('requires HTTPS outside development', () => {
    expect(readSupabaseConfig({ ...config, DEV: false }).config).toBeNull();
    expect(readSupabaseConfig({ ...config, DEV: false, VITE_SUPABASE_URL: 'https://synthetic.example' }).config).not.toBeNull();
  });
});
describe('session lifecycle', () => {
  it('distinguishes loading then restores session and updates sign-out', async () => {
    const pending = deferred(); const client = mockClient(pending.promise);
    const view = render(<AuthProvider client={client}><Probe /></AuthProvider>);
    expect(screen.getByText('loading|none|true|')).toBeInTheDocument();
    await act(async () => pending.resolve({ data: { session }, error: null }));
    expect(screen.getByText('authenticated|owner-a|false|')).toBeInTheDocument();
    act(() => client.emit(null));
    expect(screen.getByText('unauthenticated|none|false|')).toBeInTheDocument();
    act(() => client.emit({ user: { id: 'owner-b' } }));
    expect(screen.getByText('authenticated|owner-b|false|')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(session.access_token);
    view.unmount(); expect(client.unsubscribe).toHaveBeenCalledOnce();
  });
  it('restores an absent session as signed out', async () => {
    render(<AuthProvider client={mockClient(Promise.resolve({ data: { session: null } }))}><Probe /></AuthProvider>);
    await screen.findByText('unauthenticated|none|false|');
  });
  it.each(['reject', 'error'])('sanitizes restoration failure %s', async (type) => {
    const failure = new Error('secret-token-details');
    const promise = type === 'reject' ? Promise.reject(failure) : Promise.resolve({ error: failure });
    render(<AuthProvider client={mockClient(promise)}><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText(/error\|none\|false/)).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('secret-token-details');
  });
  it('does not let a stale restore overwrite a newer sign-out', async () => {
    const pending = deferred(); const client = mockClient(pending.promise);
    render(<AuthProvider client={client}><Probe /></AuthProvider>);
    act(() => client.emit(null));
    await act(async () => pending.resolve({ data: { session } }));
    expect(screen.getByText('unauthenticated|none|false|')).toBeInTheDocument();
  });
  it('keeps an initial null event from hiding a restoration error', async () => {
    const pending = deferred(); const client = mockClient(pending.promise);
    render(<AuthProvider client={client}><Probe /></AuthProvider>);
    act(() => client.emit(null, 'INITIAL_SESSION'));
    await act(async () => pending.resolve({ error: new Error('private-token') }));
    expect(screen.getByText(/error\|none\|false/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private-token');
  });
  it('ignores late events and promises after unmount', async () => {
    const pending = deferred(); const client = mockClient(pending.promise);
    const view = render(<AuthProvider client={client}><Probe /></AuthProvider>);
    view.unmount();
    await act(async () => { client.emit(session); pending.resolve({ data: { session } }); });
    expect(client.unsubscribe).toHaveBeenCalledOnce(); expect(view.container).toBeEmptyDOMElement();
  });
  it('preserves the real public weather flow while authentication is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(apiResponse([berlin])).mockResolvedValueOnce(apiResponse(daySummary));
    render(<AuthProvider client={null} configurationError="Authentication is unavailable."><WeatherProvider><App /></WeatherProvider></AuthProvider>);
    expect(screen.getByText(/Public weather remains available/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: daySummary.date } });
    fireEvent.click(screen.getByRole('button', { name: 'Search Weather' }));
    await screen.findByText('Weather loaded.');
  });
});
it('clears deleted user state and ignores late auth events for that account', async () => {
  function Controls() { const auth = useAuth(); return <><button onClick={auth.clearDeletedAccount}>Clear deleted account</button><Probe /></>; }
  const client = mockClient(Promise.resolve({ data: { session } }));
  render(<AuthProvider client={client}><Controls /></AuthProvider>);
  await screen.findByText('authenticated|owner-a|false|');
  fireEvent.click(screen.getByRole('button', { name: 'Clear deleted account' }));
  expect(screen.getByText('unauthenticated|none|false|')).toBeInTheDocument();
  act(() => client.emit(session, 'TOKEN_REFRESHED'));
  expect(screen.getByText('unauthenticated|none|false|')).toBeInTheDocument();
});
