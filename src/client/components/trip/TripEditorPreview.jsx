import { useState } from 'react';
import TripEditor from './TripEditor.jsx';
import AuthenticatedTripEditor from './AuthenticatedTripEditor.jsx';
import { useAuth } from '../../auth/context.js';
export default function TripEditorPreview() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  return (
    <section className="p-4 border-b" aria-label="Local editor testing">
      <button className="underline focus:ring-2 focus:ring-blue-500" onClick={() => setOpen(!open)}>
        {open ? 'Close local trip editor' : 'Open local trip editor'}
      </button>
      <p>
        {auth.isAuthenticated
          ? 'Development access to saved trips — changes are persisted to Supabase.'
          : 'Development preview only. Drafts are not saved. Sign in to save trips.'}
      </p>
      {open && auth.isAuthenticated && <AuthenticatedTripEditor onClose={() => setOpen(false)} />}
      {open && !auth.isAuthenticated && (
        <TripEditor onSubmit={setPreview} onCancel={() => setPreview(null)} />
      )}
      {open && !auth.isAuthenticated && preview && (
        <output className="block">Draft “{preview.title}” received for local review.</output>
      )}
    </section>
  );
}
