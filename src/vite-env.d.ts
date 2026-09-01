/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Neon Postgres connection string, queried directly from the browser over
   * HTTPS by `@neondatabase/serverless`. This ships in the client bundle — it
   * is only acceptable for an internal staff console behind a login, never a
   * public site. Copy it from the Neon console ("Connection string").
   */
  readonly VITE_DATABASE_URL: string;

  /** Firebase Web app config (Project settings → your web app → SDK setup). */
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  /** Optional — only needed if this app also uses Storage / Messaging. */
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
