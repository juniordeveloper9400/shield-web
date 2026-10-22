# Sahakar 360 Admin

Role-based operations console for the Sahakar 360 app — **React + TypeScript + Vite +
Tailwind CSS**, backed by **`backend/api`** (NestJS), which is the only thing that
talks to the Neon Postgres `app` schema the Flutter app also writes to.

It manages:

| Module | What it does | Table(s) |
| --- | --- | --- |
| **Dashboard** | Overview + a "needs attention" queue, filtered to the modules your login can open | (reads the below) |
| **Stores** | The Sahakar 360 branches — details, coverage, activate / deactivate | `app.shield_store` |
| **Catalogue** | Storefront & pharmacy-shelf products — price, stock, activate / deactivate | `app.product` (+ `app.product_category`) |
| **Orders** | Member orders — advance Processing → Out for delivery → Delivered, or cancel | `app."order"` (+ `app.order_line`) |
| **Prescriptions** | Uploaded scripts — work each one Awaiting review → Read → In cart → Ordered | `app.prescription` (+ `app.prescription_medicine`) |
| **Lab Orders** | Member lab-test bookings — Requested → Confirmed → Sample collected → Report ready | `app.lab_booking` |
| **Lab Tests** | Diagnostic packages members can book — price, activate / deactivate | `app.lab_package` |
| **Appointments** | Confirm, complete or cancel clinic / tele / dental / dietitian bookings | `app.appointment` |
| **Admins** | Create admin logins and see which modules each role can open (Super Admin only) | `app.admin_user` |

## How data flows

- **Every read and write goes through `backend/api`** (`src/lib/api.ts`'s
  `api.get/post/patch/delete`, bearer-token authenticated). Each `src/api/*.ts`
  module is a thin HTTP client over one or more `/v1/staff/*` routes; the pages
  call those and never touch SQL directly. There is **no mock data** — a
  screen is empty because the `app` table is empty (the Flutter app has not
  written those rows yet). Reference data (stores, categories, lab packages,
  clinics, dietitians) is already seeded.
- **There is no direct browser-to-Neon path.** An earlier version of this
  console queried Neon straight from the browser with
  `@neondatabase/serverless`, which meant the database owner connection string
  shipped inside the bundle — readable by anyone who opened devtools, before
  any login. That module (`src/lib/db.ts`) has been removed along with its
  dependency; every `src/api/*.ts` module now calls `backend/api` instead. If
  you ever see a `VITE_DATABASE_URL` or an import of `@neondatabase/serverless`
  reappear, treat it as a regression of this fix, not a valid pattern to copy.

## Auth & roles

Staff sign in with email + password against `POST /v1/staff/auth/session`
(`backend/api`), which checks a bcrypt hash and returns a short-lived access
token plus a refresh token (`AuthContext.tsx`). The access token is kept in
memory and attached as `Authorization: Bearer …` on every API call; the
refresh token lives in `localStorage` under `shield-admin-refresh-token` and
is exchanged for a fresh access token on expiry or reload. There is no
client-side credential list — identity, role, and (for a Pharmacy Admin) branch
scope are all resolved and enforced server-side from `app.admin_user`.

| Role | Sees |
| --- | --- |
| `superadmin` | Everything, all branches, plus the Admins page |
| `pharmacy` | Dashboard, Orders, Prescriptions, Catalogue — **their branch only** |
| `lab` | Dashboard, Lab Orders, Lab Tests |
| `appointments` | Dashboard, Appointments |

The access matrix is [`ROLE_PERMISSIONS`](src/config/permissions.ts); the branch
filter is `scopeToStore()` in the same file.

## First-time setup

1. **Backend** — `backend/api` must be running (locally, or deployed) before
   this console can do anything: it is the only thing with database access.
   See its own README for setup; it needs at least one `SUPERADMIN` row in
   `app.admin_user` to sign in with (`scripts/create-admin.mjs` in this repo
   predates the backend split and is not a substitute for that).

2. **Env** — create `.env.local` from `.env.example` and point
   `VITE_API_BASE_URL` at that backend. These values are bundled into the
   browser build.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run typecheck`.

## Deploying

This repo is standalone (split out of the Sahakar 360 mono-repo so the console can be
hosted on its own). It's a static Vite SPA — `npm run build` emits `dist/`.

- **Build command:** `npm run build`  ·  **Output dir:** `dist`  ·  **Node:** 20+
- **SPA routing:** every route must fall back to `index.html`. `vercel.json`
  (Vercel) and `public/_redirects` (Netlify / Cloudflare Pages) in this repo do
  that already.
- **Environment variables:** set `VITE_API_BASE_URL` (and the `VITE_MSG91_*` /
  `VITE_SENTRY_DSN` ones, if used) from `.env.example` in the host's
  dashboard. They are baked into the bundle at build time, so a redeploy is
  needed after changing them. There is no Neon credential to set here — the
  backend holds that.

### Bill collection SMS verification

Bill OTP uses the MSG91 widget in `src/lib/msg91Otp.ts`, configured by
`VITE_MSG91_WIDGET_ID` and `VITE_MSG91_TOKEN_AUTH`. The widget's access token is
re-checked by `POST /v1/staff/otp/verify-msg91` before the bill collection API
is called; retrying collection after a consumed code requires another SMS.

Agent withdrawal approval OTP is sent and checked entirely by `backend/api`
(`POST /v1/staff/agent-withdrawals/:id/otp`, then `otpCode` on the approval).

Run `npm run typecheck` and `npm run build`. Real SMS delivery and bill settlement
must also be checked on the authorized deployment.
