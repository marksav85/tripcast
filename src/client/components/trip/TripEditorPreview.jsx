import { useState } from 'react';
import TripEditor from './TripEditor.jsx';
export default function TripEditorPreview() {
  const [open, setOpen] = useState(false); const [preview, setPreview] = useState(null);
  return <section className="p-4 border-b" aria-label="Local editor testing">
    <button className="underline focus:ring-2 focus:ring-blue-500" onClick={() => setOpen(!open)}>{open ? 'Close local trip editor' : 'Open local trip editor'}</button>
    <p>Development preview only. Drafts are not saved.</p>
    {open && <TripEditor onSubmit={setPreview} onCancel={() => setPreview(null)} />}
    {open && preview && <output className="block">Draft “{preview.title}” received for local review.</output>}
  </section>;
}
