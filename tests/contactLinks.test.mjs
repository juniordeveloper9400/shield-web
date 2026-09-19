import assert from 'node:assert/strict';
import test from 'node:test';
import { telHref, whatsappHref } from '../src/lib/contactLinks.ts';

test('a plain 10-digit number gets the +91 prefix once for WhatsApp', () => {
  assert.equal(whatsappHref('9876543210'), 'https://wa.me/919876543210');
  assert.equal(telHref('9876543210'), 'tel:9876543210');
});

test('a number already carrying +91 or 91 is not double-prefixed', () => {
  assert.equal(whatsappHref('+91 98765 43210'), 'https://wa.me/919876543210');
  assert.equal(whatsappHref('919876543210'), 'https://wa.me/919876543210');
  assert.equal(telHref('+91-98765-43210'), 'tel:9876543210');
});

test('a blank number has no link', () => {
  assert.equal(whatsappHref('  '), undefined);
  assert.equal(telHref(''), undefined);
});
