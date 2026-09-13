import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

/**
 * Firebase Auth for staff sign-in (Email/Password) — the same `shield-zabnix`
 * project the member app already uses for Phone auth, a separate sign-in
 * method on it. Replaces the static credential list that used to live in
 * `config/admins.ts`. See backend/docs/security.md "Authentication".
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
