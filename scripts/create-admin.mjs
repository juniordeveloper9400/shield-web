// Bootstrap / manage a SHIELD Admin login from the command line.
//
// Creates the Firebase Email/Password account (via the Firebase Auth REST API)
// and the matching `app.admin_user` row on Neon. Use it once to make the first
// Super Admin — after that, Super Admins add colleagues from the Admins page.
//
//   node scripts/create-admin.mjs \
//     --email superadmin@shield.co.in --password 's3cret!!' \
//     --name "Aarav Menon" --role superadmin
//
//   node scripts/create-admin.mjs --email lab@shield.co.in --password 'pw' \
//     --name "Kabir Shah" --role lab
//
//   node scripts/create-admin.mjs --email mel@shield.co.in --password 'pw' \
//     --name "Divya Rao" --role pharmacy --store SHD-MEL
//
// Reads VITE_DATABASE_URL and VITE_FIREBASE_API_KEY from .env.local (or the
// environment). Requires Authentication → Email/Password to be enabled in the
// Firebase console. Roles: superadmin | pharmacy | lab | appointments.

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      if (!(k in env)) env[k] = t.slice(eq + 1).trim();
    }
  } catch {
    /* no .env.local — rely on the environment */
  }
  return env;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const ROLES = new Set(['superadmin', 'pharmacy', 'lab', 'appointments']);

async function main() {
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));

  const email = String(args.email || '').trim().toLowerCase();
  const password = String(args.password || '');
  const name = String(args.name || '').trim();
  const role = String(args.role || '').trim().toLowerCase();
  const store = args.store ? String(args.store).trim().toUpperCase() : null;

  if (!email || !password || !name || !ROLES.has(role)) {
    console.error(
      'Usage: node scripts/create-admin.mjs --email <e> --password <p> ' +
        '--name "<n>" --role <superadmin|pharmacy|lab|appointments> [--store SHD-XXX]',
    );
    process.exit(1);
  }
  if (role === 'pharmacy' && !store) {
    console.error('A pharmacy admin needs --store (e.g. --store SHD-MEL).');
    process.exit(1);
  }

  const dbUrl = env.VITE_DATABASE_URL;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  if (!dbUrl) throw new Error('VITE_DATABASE_URL is not set (.env.local).');
  if (!apiKey) throw new Error('VITE_FIREBASE_API_KEY is not set (.env.local).');

  // 1 · Firebase account.
  let firebaseUid = null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (res.ok) {
    firebaseUid = body.localId;
    console.log(`Firebase: created account ${email} (uid ${firebaseUid}).`);
  } else if (body?.error?.message === 'EMAIL_EXISTS') {
    console.log(
      `Firebase: ${email} already exists — the admin row will link on first sign-in.`,
    );
  } else if (body?.error?.message === 'OPERATION_NOT_ALLOWED') {
    throw new Error(
      'Firebase rejected the sign-up: enable Authentication → Sign-in method → ' +
        'Email/Password in the console.',
    );
  } else {
    throw new Error(`Firebase sign-up failed: ${JSON.stringify(body.error ?? body)}`);
  }

  // 2 · Neon admin_user row.
  const sql = neon(dbUrl);
  const existing = await sql`SELECT id FROM app.admin_user WHERE lower(email) = ${email}`;
  if (existing.length) {
    await sql`
      UPDATE app.admin_user
         SET name = ${name},
             role = ${role.toUpperCase()}::app.admin_role,
             store_id = (SELECT id FROM app.shield_store WHERE code = ${store}),
             firebase_uid = COALESCE(firebase_uid, ${firebaseUid}),
             is_active = true
       WHERE lower(email) = ${email}`;
    console.log(`Neon: updated existing admin_user row for ${email}.`);
  } else {
    await sql`
      INSERT INTO app.admin_user (firebase_uid, email, name, role, store_id)
      VALUES (
        ${firebaseUid}, ${email}, ${name}, ${role.toUpperCase()}::app.admin_role,
        (SELECT id FROM app.shield_store WHERE code = ${store})
      )`;
    console.log(`Neon: inserted admin_user row for ${email} (${role}${store ? ' · ' + store : ''}).`);
  }

  console.log('\nDone. Sign in at the console with that email and password.');
}

main().catch((err) => {
  console.error('\n' + (err?.message ?? err));
  process.exit(1);
});
