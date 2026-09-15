import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';

// Keep the shared backend's Vercel functions and Neon database from
// suspending while this console is open, the same reasoning and interval as
// `shield agent_invester`'s `BackendHttp.keepWarm` (see that method's own
// doc): both are on free tiers that go idle after a few minutes, and the
// repo's GitHub Actions cron meant to prevent that has proven unreliable in
// practice (confirmed: correctly configured, zero scheduled firings in six-
// plus hours). `/readyz` runs a real query, so this keeps the same Neon
// compute this console's own direct-Neon reads depend on warm too, not just
// the backend's own functions. Fire-and-forget — a failed ping here must
// never surface as an error to whoever has this tab open.
const backendBase = import.meta.env.VITE_API_BASE_URL;
if (backendBase) {
  setInterval(() => {
    fetch(`${backendBase}/readyz`).catch(() => {
      /* best-effort — see comment above */
    });
  }, 4 * 60 * 1000);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
