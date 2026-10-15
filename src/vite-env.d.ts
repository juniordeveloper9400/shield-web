/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the backend/api service (backend/docs/) — e.g.
   * https://shield-api.example.com or http://localhost:3000 for local dev.
   * Every data operation and staff auth call (/v1/staff/*) goes through it;
   * there is no longer a direct-to-Neon path from the browser.
   */
  readonly VITE_API_BASE_URL: string;

  /**
   * Sentry DSN for crash and error reporting (main.tsx). Optional — an empty
   * value leaves Sentry disabled, the same as the two above being unset
   * leaves their own features off rather than erroring. See docs/sentry.md.
   */
  readonly VITE_SENTRY_DSN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
