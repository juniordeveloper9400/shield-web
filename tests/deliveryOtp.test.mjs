import assert from 'node:assert/strict';
import test from 'node:test';
import * as otp from '../src/lib/deliveryOtp.ts';

test('hostname rejection identifies the domain that must be authorized', () => {
  const message = otp.describeOtpError({
    code: 'auth/captcha-check-failed',
    message: 'Firebase: Hostname match not found (auth/captcha-check-failed).',
  }, 'admin.example.com');
  assert.match(message, /admin\.example\.com/);
  assert.match(message, /Authorized domains/);
  assert.match(message, /shield-zabnix/);
});

test('expired captcha asks for retry rather than claiming domain rejection', () => {
  const message = otp.describeOtpError({ code: 'auth/captcha-check-failed' }, 'admin.example.com');
  assert.match(message, /try again/i);
  assert.doesNotMatch(message, /Authorized domains/);
});

test('local and international Indian numbers resolve to the same SMS recipient', () => {
  for (const phone of ['9876543210', '+919876543210', '919876543210', '+91 98765 43210']) {
    assert.equal(otp.normalizeDeliveryPhone(phone), '+919876543210');
  }
  for (const phone of ['', '1234', '+449876543210', '98765abc43210']) {
    assert.throws(() => otp.normalizeDeliveryPhone(phone), { code: 'auth/invalid-phone-number' });
  }
});

test('wrong and expired SMS codes remain verification failures', () => {
  assert.match(otp.describeOtpError({ code: 'auth/invalid-verification-code' }), /not right/);
  assert.match(otp.describeOtpError({ code: 'auth/code-expired' }), /expired/);
});

test('malformed SMS codes never reach Firebase confirmation', async () => {
  let attempted = false;
  const confirmation = { confirm: async () => { attempted = true; } };
  for (const code of ['', '123', '12345a', '1234567']) {
    await assert.rejects(otp.confirmDeliveryOtp(confirmation, code), {
      code: 'auth/invalid-verification-code',
    });
  }
  assert.equal(attempted, false);
});

test('Firebase rejection cannot become successful verification', async () => {
  const invalid = Object.assign(new Error('Incorrect SMS code'), {
    code: 'auth/invalid-verification-code',
  });
  await assert.rejects(otp.confirmDeliveryOtp({
    confirm: async (code) => {
      assert.equal(code, '123456');
      throw invalid;
    },
  }, '123456'), invalid);
});
