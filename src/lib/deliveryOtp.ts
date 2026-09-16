import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';

// SHIELD's Firebase project (`shield-zabnix`) — the same public web config
// `shield agent_invester/lib/firebase_options.dart` ships to every browser.
// Not secret: Firebase's own docs treat this as safe to embed in a client
// bundle (domain/App Check restrictions are the actual gate, not this key).
//
// This console stopped using Firebase for *staff* login a while back (see
// `.env.example`) — this is a narrower, unrelated use: verifying that
// whoever is standing in front of the delivery/counter staff really holds
// the *member's* phone, before a bill is settled off their wallet. It never
// touches this app's own staff session.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAjXbkhrPPgq9hwlhdKB21dG2VfvatAXTI',
  appId: '1:1086152719549:web:199b8c17ac57081cda0bd4',
  messagingSenderId: '1086152719549',
  projectId: 'shield-zabnix',
  authDomain: 'shield-zabnix.firebaseapp.com',
  storageBucket: 'shield-zabnix.firebasestorage.app',
};

const OTP_APP_NAME = 'delivery-otp';

function otpApp(): FirebaseApp {
  const existing = getApps().find((a) => a.name === OTP_APP_NAME);
  return existing ?? initializeApp(FIREBASE_CONFIG, OTP_APP_NAME);
}

/**
 * Builds a fresh invisible reCAPTCHA bound to [containerId] every call,
 * clearing whatever the previous one was bound to first.
 *
 * This used to cache and reuse one verifier across calls — reasonable in a
 * plain page, but `containerId` here is a `<div>` React mounts inside
 * `BillEditorModal`, which is destroyed the moment the modal closes (or a
 * different order's modal opens with a different id). A cached verifier
 * still pointed at that now-detached node, so the *second* "Send OTP" ever
 * attempted — a reopened modal, a different order, a plain "Resend" —
 * failed with Firebase's own "reCAPTCHA client element has been removed."
 * Always building fresh, against whatever container is live right now, is
 * what actually matches this component's lifecycle. The previous instance
 * is cleared first — needed for "Resend" specifically, where the container
 * is still mounted and Google's own widget would otherwise render twice
 * into the same `<div>`; harmless (Firebase swallows it) when the previous
 * container is already gone.
 */
let lastVerifier: RecaptchaVerifier | null = null;

function freshVerifier(containerId: string): RecaptchaVerifier {
  try {
    lastVerifier?.clear();
  } catch {
    // Already gone (its container was unmounted) — nothing to clean up.
  }
  lastVerifier = new RecaptchaVerifier(getAuth(otpApp()), containerId, {
    size: 'invisible',
  });
  return lastVerifier;
}

/**
 * Sends a real SMS OTP to [phone] (10 digits, no `+91`) via Firebase Phone
 * Auth — the member's own phone, not the signed-in staff member's. Staff
 * reads back whatever code the member tells them and passes it to
 * [confirmDeliveryOtp]; nothing here signs anyone into anything, it is only
 * ever used for its pass/fail verification.
 */
export async function sendDeliveryOtp(
  phone: string,
  containerId: string,
): Promise<ConfirmationResult> {
  const auth = getAuth(otpApp());
  return signInWithPhoneNumber(auth, `+91${phone}`, freshVerifier(containerId));
}

/**
 * Checks [code] against the confirmation [sendDeliveryOtp] returned. Throws
 * (with Firebase's own error code, e.g. `auth/invalid-verification-code`) on
 * a wrong or expired code — the caller decides what money-moving follow-up,
 * if any, a success unlocks.
 */
export async function confirmDeliveryOtp(
  confirmation: ConfirmationResult,
  code: string,
): Promise<void> {
  const credential = await confirmation.confirm(code.trim());
  // A throwaway verification, not a sign-in this console keeps: drop it
  // immediately so it can never be mistaken for (or collide with) this
  // staff member's own session.
  await getAuth(otpApp()).signOut();
  void credential;
}

/** Firebase's own error code → what to tell the person holding the bill. */
export function describeOtpError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  switch (code) {
    case 'auth/invalid-verification-code':
      return 'That code is not right. Ask the member to read it out again.';
    case 'auth/code-expired':
      return 'That code has expired — send a new one.';
    case 'auth/invalid-phone-number':
      return "This member's phone number on file looks invalid.";
    case 'auth/too-many-requests':
      return 'Too many attempts — wait a bit before trying again.';
    default:
      return error instanceof Error ? error.message : 'Could not verify that code.';
  }
}
