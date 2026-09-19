import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
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

/** Each send owns a separate reCAPTCHA node. A late render from an earlier
 * attempt cannot collide with the next send or a reopened bill modal. */
const verifiers = new Map<string, { verifier: RecaptchaVerifier; element: HTMLElement }>();

export function clearDeliveryOtp(containerId: string): void {
  const current = verifiers.get(containerId);
  verifiers.delete(containerId);
  try {
    current?.verifier.clear();
  } catch {
    // The modal or Firebase may already have removed the widget.
  }
  current?.element.remove();
}

function freshVerifier(containerId: string): RecaptchaVerifier {
  clearDeliveryOtp(containerId);
  const container = document.getElementById(containerId);
  if (!container) throw new Error('Reopen this bill before sending a code.');
  // Give each attempt its own node. A late render from a previous attempt
  // must never render into the new attempt's container.
  const element = document.createElement('div');
  container.replaceChildren(element);

  const verifier = new RecaptchaVerifier(getAuth(otpApp()), element, {
    size: 'invisible',
  });
  verifiers.set(containerId, { verifier, element });
  return verifier;
}

export function normalizeDeliveryPhone(phone: string): string {
  const compact = phone.trim().replace(/[\s()-]/g, '');
  const local = compact.replace(/^(?:\+91|91)(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(local)) {
    throw Object.assign(new Error('Invalid member phone number.'), {
      code: 'auth/invalid-phone-number',
    });
  }
  return `+91${local}`;
}

/**
 * Sends a real SMS OTP to [phone] (Indian local or `+91` format) via Firebase Phone
 * Auth — the member's own phone, not the signed-in staff member's. Staff
 * reads back whatever code the member tells them and passes it to
 * [confirmDeliveryOtp]; nothing here signs anyone into anything, it is only
 * ever used for its pass/fail verification.
 */
export async function sendDeliveryOtp(
  phone: string,
  containerId: string,
): Promise<ConfirmationResult> {
  const recipient = normalizeDeliveryPhone(phone);
  const auth = getAuth(otpApp());
  const verifier = freshVerifier(containerId);
  try {
    return await signInWithPhoneNumber(auth, recipient, verifier);
  } finally {
    if (verifiers.get(containerId)?.verifier === verifier) {
      clearDeliveryOtp(containerId);
    }
  }
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
  if (!/^\d{6}$/.test(code.trim())) {
    throw Object.assign(new Error('Enter the six-digit SMS code.'), {
      code: 'auth/invalid-verification-code',
    });
  }
  const credential = await confirmation.confirm(code.trim());
  // A throwaway verification, not a sign-in this console keeps: drop it
  // immediately so it can never be mistaken for (or collide with) this
  // staff member's own session.
  await getAuth(otpApp()).signOut();
  void credential;
}

/** Firebase's own error code → what to tell the person holding the bill. */
export function describeOtpError(
  error: unknown,
  hostname = typeof window === 'undefined' ? 'this admin website' : window.location.hostname,
): string {
  const code =
    error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error && typeof error === 'object' && 'message' in error
    ? String(error.message) : '';
  const domainHelp = `OTP is blocked for ${hostname}. Add this exact hostname in Firebase project shield-zabnix → Authentication → Settings → Authorized domains, then reload this page.`;
  switch (code) {
    case 'auth/unauthorized-domain':
      return domainHelp;
    case 'auth/captcha-check-failed':
      return /hostname match not found/i.test(message)
        ? domainHelp
        : 'The browser verification failed or expired. Please try again to get a fresh verification.';
    case 'auth/network-request-failed':
      return 'Could not reach the OTP service. Check your connection and try again.';
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
