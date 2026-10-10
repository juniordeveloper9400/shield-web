import { api } from './api';

/**
 * MSG91 Widget OTP — replaces Firebase Phone Auth for the counter/
 * delivery OTP check `BillEditorModal` and `LabBookingModal` use before
 * collecting a bill off a member's wallet. `deliveryOtp.ts` is left as-is
 * and still backs `AgentWithdrawalsPage`'s separate agent-withdrawal-
 * approval OTP (a different mechanism, out of scope here).
 *
 * The widget does the actual SMS send/verify entirely in the browser and
 * hands back a signed access-token on success. That token alone proves
 * nothing — anything client-side can be forged by a modified browser — so
 * `confirmDeliveryOtp` below always has the backend re-check it against
 * MSG91's own servers (`POST /v1/staff/otp/verify-msg91`, see
 * `backend/api/src/modules/otp/otp.service.ts`) before treating the code
 * as verified.
 *
 * STATUS: `widgetId`/`tokenAuth` below were confirmed from this project's
 * own MSG91 dashboard ("Client/Server Side Integration" tabs). The widget
 * script URL and the `exposeMethods: true` global function names
 * (`sendOtp`/`retryOtp`/`verifyOtp`) are MSG91's standard documented widget
 * API, not yet exercised against this specific widgetId — confirm the
 * first real send/verify in the browser console and adjust
 * `accessTokenFrom`/`toOtpError` below if the callback payload shape
 * differs from what's assumed here.
 */
const WIDGET_ID = import.meta.env.VITE_MSG91_WIDGET_ID as string | undefined;
const TOKEN_AUTH = import.meta.env.VITE_MSG91_TOKEN_AUTH as string | undefined;
const WIDGET_SCRIPT_URL = 'https://verify.msg91.com/otp-provider.js';

type Msg91Callback = (data: unknown) => void;

declare global {
  interface Window {
    initSendOTP?: (config: Record<string, unknown>) => void;
    sendOtp?: (identifier: string, onSuccess: Msg91Callback, onFailure: Msg91Callback) => void;
    verifyOtp?: (otp: string, onSuccess: Msg91Callback, onFailure: Msg91Callback, reqId?: string) => void;
  }
}

let scriptPromise: Promise<void> | null = null;
let widgetInitialized = false;

function loadWidgetScript(): Promise<void> {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${WIDGET_SCRIPT_URL}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = WIDGET_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(otpError('msg91/script-missing', 'Could not load the OTP verification script.'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

async function ensureWidget(): Promise<void> {
  if (!WIDGET_ID || !TOKEN_AUTH) {
    throw otpError(
      'msg91/not-configured',
      'OTP sending is not configured in this deployment (missing VITE_MSG91_WIDGET_ID/VITE_MSG91_TOKEN_AUTH).',
    );
  }
  await loadWidgetScript();
  if (!window.initSendOTP) {
    throw otpError('msg91/script-missing', 'The OTP verification script did not load correctly.');
  }
  if (!widgetInitialized) {
    window.initSendOTP({
      widgetId: WIDGET_ID,
      tokenAuth: TOKEN_AUTH,
      exposeMethods: true,
      success: () => {},
      failure: () => {},
    });
    // initSendOTP defers its own setup (it waits for DOMContentLoaded, or a
    // 1ms setTimeout when the document is already ready — confirmed by
    // reading the real minified function body in a browser console) before
    // actually attaching window.sendOtp/verifyOtp. They are deliberately
    // NOT checked synchronously right after this call — that was the exact
    // bug behind "The OTP verification script did not load correctly"
    // firing on every real attempt, confirmed 2026-10-10: initSendOTP
    // itself was always present, sendOtp/verifyOtp just were not yet.
    await waitForExposedMethods();
    widgetInitialized = true;
  }
}

/** Polls for `window.sendOtp`/`window.verifyOtp` to appear after
 *  `initSendOTP` runs — see `ensureWidget`'s own doc on why this can't be
 *  a single synchronous check. */
async function waitForExposedMethods(): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (window.sendOtp && window.verifyOtp) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw otpError('msg91/script-missing', 'The OTP verification script did not load correctly.');
}

export function normalizeDeliveryPhone(phone: string): string {
  const compact = phone.trim().replace(/[\s()-]/g, '');
  const local = compact.replace(/^(?:\+91|91)(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(local)) {
    throw otpError('msg91/invalid-phone-number', 'Invalid member phone number.');
  }
  return `91${local}`; // MSG91 identifiers are plain digits, country-code-prefixed — no leading '+'.
}

/** What `sendDeliveryOtp` hands back — just the phone it was sent to.
 *  Unlike Firebase's `ConfirmationResult`, MSG91's widget tracks the
 *  in-flight request itself; this only needs to survive long enough for
 *  `confirmDeliveryOtp` to tell the backend which phone the code should
 *  match. */
export interface OtpConfirmation {
  phone: string;
}

/**
 * Sends a real SMS OTP to [phone] (Indian local or `+91`/`91` format) via
 * the MSG91 widget — headless, no DOM container needed (unlike the old
 * Firebase reCAPTCHA-based version this replaces).
 */
export async function sendDeliveryOtp(phone: string): Promise<OtpConfirmation> {
  const identifier = normalizeDeliveryPhone(phone);
  await ensureWidget();
  await new Promise<void>((resolve, reject) => {
    window.sendOtp!(identifier, () => resolve(), (err) => reject(toOtpError(err)));
  });
  return { phone: identifier };
}

/**
 * Checks [code] against the confirmation [sendDeliveryOtp] returned, then
 * has the backend confirm the resulting MSG91 access-token really belongs
 * to that phone — the step that makes this trustworthy rather than a
 * client-side-only claim. [accessToken] is the signed-in staff member's own
 * bearer token, needed to call the backend endpoint.
 */
export async function confirmDeliveryOtp(
  confirmation: OtpConfirmation,
  code: string,
  accessToken: string | null,
): Promise<void> {
  if (!/^\d{4,6}$/.test(code.trim())) {
    throw otpError('msg91/invalid-verification-code', 'Enter the code the member read out.');
  }
  await ensureWidget();
  const widgetToken = await new Promise<string>((resolve, reject) => {
    window.verifyOtp!(
      code.trim(),
      (data) => {
        const token = accessTokenFrom(data);
        if (token) resolve(token);
        else reject(otpError('msg91/unexpected-response', 'Could not verify that code.'));
      },
      (err) => reject(toOtpError(err)),
    );
  });
  const result = await api.post<{ ok: boolean; reason?: string }>(
    '/v1/staff/otp/verify-msg91',
    { accessToken: widgetToken, expectedPhone: confirmation.phone },
    accessToken,
  );
  if (!result.ok) {
    throw otpError('msg91/server-rejected', result.reason ?? 'That code is not right or has expired.');
  }
}

function accessTokenFrom(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const candidate = obj['access-token'] ?? obj.message ?? obj.token;
    if (typeof candidate === 'string') return candidate;
  }
  return null;
}

function otpError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function toOtpError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return otpError('msg91/failure', err);
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const message = typeof obj.message === 'string' ? obj.message : 'Could not send the code.';
    return Object.assign(otpError('msg91/failure', message), { raw: err });
  }
  return otpError('msg91/failure', 'Could not send the code.');
}

/** MSG91 (or this module's own) error → what to tell the person holding
 *  the bill. */
export function describeOtpError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : '';
  switch (code) {
    case 'msg91/not-configured':
      return 'OTP sending is not set up on this website yet — contact an admin.';
    case 'msg91/invalid-phone-number':
      return "This member's phone number on file looks invalid.";
    case 'msg91/invalid-verification-code':
      return message;
    case 'msg91/server-rejected':
      return message || 'That code is not right or has expired.';
    case 'msg91/unexpected-response':
    case 'msg91/script-missing':
      return message || 'Could not verify that code — please try again.';
    default:
      return message || 'Could not verify that code.';
  }
}
