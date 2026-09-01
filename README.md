# SHIELD Admin

Role-based operations console for the SHIELD app — **React + TypeScript + Vite +
Tailwind CSS**, backed by the **same Neon Postgres `app` schema the Flutter app
writes to** and **Firebase Email/Password** auth.

It manages:

| Module | What it does | Table(s) |
| --- | --- | --- |
| **Dashboard** | Overview + a "needs attention" queue, filtered to the modules your login can open | (reads the below) |
| **Stores** | The SHIELD branches — details, coverage, activate / deactivate | `app.shield_store` |
| **Catalogue** | Storefront & pharmacy-shelf products — price, stock, activate / deactivate | `app.product` (+ `app.product_category`) |
| **Orders** | Member orders — advance Processing → Out for delivery → Delivered, or cancel | `app."order"` (+ `app.order_line`) |
| **Prescriptions** | Uploaded scripts — work each one Awaiting review → Read → In cart → Ordered | `app.prescription` (+ `app.prescription_medicine`) |
| **Lab Orders** | Member lab-test bookings — Requested → Confirmed → Sample collected → Report ready | `app.lab_booking` |
| **Lab Tests** | Diagnostic packages members can book — price, activate / deactivate | `app.lab_package` |
| **Appointments** | Confirm, complete or cancel clinic / tele / dental / dietitian bookings | `app.appointment` |
| **Admins** | Create admin logins and see which modules each role can open (Super Admin only) | `app.admin_user` |

## How data flows

- **Reads/writes go straight to Neon over HTTPS** with
  [`@neondatabase/serverless`](https://github.com/neondatabase/serverless) — see
  [`src/lib/db.ts`](src/lib/db.ts). Each `src/api/*.ts` module is a thin query
  layer; the pages call those and never touch SQL. There is **no mock data** —
  a screen is empty because the `app` table is empty (the Flutter app has not
  written those rows yet). Reference data (stores, categories, lab packages,
  clinics, dietitians) is already seeded.
- **The Neon connection string is bundled into the shipped JS.** That is only
  acceptable because this console is staff-only and behind the login. A public
  deployment must move the queries behind a server API.

## Auth & roles

Every admin signs in with their **work email + password** (Firebase
Email/Password, project `shield-zabnix`). The Firebase account proves *who*;
the [`app.admin_user`](../backend/db/migrations/0001_admin_user.sql) row says
*what they can do* — role, and for a Pharmacy Admin the one branch they work.

| Role | Sees |
| --- | --- |
| `superadmin` | Everything, all branches, plus the Admins page |
| `pharmacy` | Dashboard, Orders, Prescriptions, Catalogue — **their branch only** |
| `lab` | Dashboard, Lab Orders, Lab Tests |
| `appointments` | Dashboard, Appointments |

The access matrix is [`ROLE_PERMISSIONS`](src/config/permissions.ts); the branch
filter is `scopeToStore()` in the same file. `AuthContext` resolves the signed-in
email to its `admin_user` row and drops the session if there is no active row.

## First-time setup

1. **Database** — the admin table:
   ```bash
   # from the repo root, with .env holding DATABASE_URL
   dart run backend/db/apply_migration.dart backend/db/migrations/0001_admin_user.sql --yes
   ```
   (idempotent — safe to re-run).

2. **Firebase** — in the [console](https://console.firebase.google.com/):
   register a **Web app** under Project settings → General, and enable
   **Authentication → Sign-in method → Email/Password**.

3. **Env** — `cp .env.example .env.local` and fill in `VITE_DATABASE_URL` and
   the `VITE_FIREBASE_*` values from the Web app's "SDK setup and configuration".

4. **First admin** — create the Super Admin login:
   ```bash
   npm install
   node scripts/create-admin.mjs \
     --email superadmin@shield.co.in --password 'choose-a-strong-one' \
     --name "Your Name" --role superadmin
   ```
   Every other login is then added from the **Admins** page.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run typecheck`.

## Deploying

This repo is standalone (split out of the SHIELD mono-repo so the console can be
hosted on its own). It's a static Vite SPA — `npm run build` emits `dist/`.

- **Build command:** `npm run build`  ·  **Output dir:** `dist`  ·  **Node:** 20+
- **SPA routing:** every route must fall back to `index.html`. `vercel.json`
  (Vercel) and `public/_redirects` (Netlify / Cloudflare Pages) in this repo do
  that already.
- **Environment variables:** set `VITE_DATABASE_URL` and every `VITE_FIREBASE_*`
  from `.env.example` in the host's dashboard. They are baked into the bundle at
  build time, so a redeploy is needed after changing them.
- After the domain is live, add it under Firebase console → Authentication →
  Settings → **Authorized domains**, or sign-in is rejected.
