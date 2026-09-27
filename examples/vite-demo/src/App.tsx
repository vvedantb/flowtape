import { useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';

/** Synthetic seed data. Nothing here is real. */
const SEED_NOTES = [
  { id: 1, text: 'Call the plumber about the kitchen tap' },
  { id: 2, text: 'Book dentist for Tuesday' },
  { id: 3, text: 'Renew library card' },
];

const NAVIGATE_EVENT = 'demo:navigate';

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function App() {
  const pathname = usePathname();
  return <main style={styles.page}>{pathname === '/notes' ? <Notes /> : <Login />}</main>;
}

function Login() {
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = data.get('email');
    if (typeof email !== 'string' || !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    navigate('/notes');
  };

  return (
    <form data-testid="login-form" method="post" onSubmit={onSubmit} style={styles.card}>
      <h1 style={styles.title}>Sign in</h1>
      <label style={styles.label}>
        Email
        <input data-testid="login-email" name="email" type="email" style={styles.input} />
      </label>
      <label style={styles.label}>
        Password
        <input data-testid="login-password" name="password" type="password" style={styles.input} />
      </label>
      <label style={styles.label} data-flowtape-mask>
        Member ID
        <input data-testid="login-member-id" name="memberId" placeholder="123-45-6789" style={styles.input} />
      </label>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      <button data-testid="login-submit" type="submit" style={styles.button}>
        Sign in
      </button>
    </form>
  );
}

function Notes() {
  const [notes, setNotes] = useState(SEED_NOTES);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const text = new FormData(form).get('note');
    if (typeof text !== 'string' || !text.trim()) return;
    setNotes((current) => [...current, { id: current.length + 1, text: text.trim() }]);
    form.reset();
  };

  return (
    <section style={styles.card}>
      <h1 style={styles.title}>Notes</h1>
      <ul data-testid="notes-list" style={styles.list}>
        {notes.map((note) => (
          <li key={note.id} data-testid="note-item">
            {note.text}
          </li>
        ))}
      </ul>
      <form data-testid="note-form" onSubmit={onSubmit} style={styles.row}>
        <input data-testid="note-input" name="note" aria-label="New note" placeholder="New note" style={{ ...styles.input, flex: 1 }} />
        <button data-testid="note-add" type="submit" style={styles.button}>
          Add note
        </button>
      </form>
      <button data-testid="sign-out" type="button" onClick={() => navigate('/')} style={styles.link}>
        Sign out
      </button>
    </section>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f4f6', font: '14px/1.5 system-ui, sans-serif' },
  card: { width: 360, padding: 24, borderRadius: 12, background: '#fff', display: 'grid', gap: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  title: { margin: 0, fontSize: 20 },
  label: { display: 'grid', gap: 4 },
  input: { padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', font: 'inherit' },
  button: { padding: '8px 12px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff', font: 'inherit', cursor: 'pointer' },
  link: { justifySelf: 'start', padding: 0, border: 0, background: 'none', color: '#2563eb', font: 'inherit', cursor: 'pointer' },
  error: { margin: 0, color: '#b91c1c' },
  list: { margin: 0, paddingLeft: 20 },
  row: { display: 'flex', gap: 8 },
} satisfies Record<string, CSSProperties>;
