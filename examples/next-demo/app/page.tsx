'use client';

import Link from 'next/link';
import { useState } from 'react';

// Synthetic data only.
export default function NotesPage() {
  const [notes, setNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  return (
    <main>
      <h1>Notes</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          setNotes([...notes, draft.trim()]);
          setDraft('');
        }}
      >
        <label htmlFor="note">Note</label> <input id="note" data-testid="note-input" value={draft} onChange={(event) => setDraft(event.target.value)} />{' '}
        <button type="submit" data-testid="note-add">
          Add note
        </button>
      </form>
      <ul>
        {notes.map((note, index) => (
          <li key={index} data-testid="note-item">
            {note}
          </li>
        ))}
      </ul>
      <Link href="/about" data-testid="about-link">
        About
      </Link>
    </main>
  );
}
