import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REPORT_PAGES,
  canAttachReport,
  canEditNote,
  canRemoveReportPage,
  canReschedule,
  fromLocalInput,
  nextStepBlocker,
  reportFilesProblem,
  toLocalInput,
} from '../src/lib/labBooking.ts';

const jpg = (name = 'page.jpg', size = 1000) => ({ name, type: 'image/jpeg', size });

test('images are accepted as report pages', () => {
  assert.equal(reportFilesProblem([jpg(), jpg('b.png')], 0), null);
});

test('nothing picked is a problem', () => {
  assert.match(reportFilesProblem([], 0), /at least one page/);
});

test('a PDF is refused with a plain explanation, by type or by name', () => {
  const byType = reportFilesProblem([{ name: 'r.bin', type: 'application/pdf', size: 10 }], 0);
  assert.match(byType, /PDF/);
  const byName = reportFilesProblem([{ name: 'REPORT.PDF', type: '', size: 10 }], 0);
  assert.match(byName, /PDF/);
});

test('a non-image file is refused', () => {
  assert.match(
    reportFilesProblem([{ name: 'notes.txt', type: 'text/plain', size: 10 }], 0),
    /not an image/,
  );
});

test('a huge file is refused', () => {
  assert.match(reportFilesProblem([jpg('big.jpg', 20 * 1024 * 1024)], 0), /larger than 15 MB/);
});

test('the page cap counts pages already attached', () => {
  const twelve = Array.from({ length: MAX_REPORT_PAGES }, () => jpg());
  assert.equal(reportFilesProblem(twelve, 0), null);
  assert.match(reportFilesProblem([jpg(), jpg()], MAX_REPORT_PAGES - 1), /room for 1 more/);
  assert.match(reportFilesProblem([jpg()], MAX_REPORT_PAGES), /room for 0 more/);
});

test('rescheduling stops once a report is ready or the booking is cancelled', () => {
  assert.equal(canReschedule('requested'), true);
  assert.equal(canReschedule('confirmed'), true);
  assert.equal(canReschedule('sample_collected'), true);
  assert.equal(canReschedule('report_ready'), false);
  assert.equal(canReschedule('cancelled'), false);
});

test('the note can be edited until the booking is cancelled', () => {
  assert.equal(canEditNote('report_ready'), true);
  assert.equal(canEditNote('cancelled'), false);
});

test('pages can be attached only from sample collection onward', () => {
  assert.equal(canAttachReport('requested'), false);
  assert.equal(canAttachReport('confirmed'), false);
  assert.equal(canAttachReport('sample_collected'), true);
  assert.equal(canAttachReport('report_ready'), true);
  assert.equal(canAttachReport('cancelled'), false);
});

test('"Report ready" is blocked until at least one page is attached', () => {
  assert.match(nextStepBlocker('sample_collected', 0), /Attach the report/);
  assert.equal(nextStepBlocker('sample_collected', 1), null);
  assert.equal(nextStepBlocker('requested', 0), null);
  assert.equal(nextStepBlocker('confirmed', 0), null);
});

test('a Report-ready booking always keeps at least one page', () => {
  assert.equal(canRemoveReportPage('sample_collected', 1), true);
  assert.equal(canRemoveReportPage('report_ready', 2), true);
  assert.equal(canRemoveReportPage('report_ready', 1), false);
  assert.equal(canRemoveReportPage('cancelled', 3), false);
});

test('a date survives the trip through a datetime-local input', () => {
  const iso = '2026-09-25T04:30:00.000Z';
  const local = toLocalInput(iso);
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(fromLocalInput(local), iso);
});

test('blank or invalid dates are handled', () => {
  assert.equal(toLocalInput(''), '');
  assert.equal(toLocalInput('not a date'), '');
  assert.equal(fromLocalInput(''), null);
  assert.equal(fromLocalInput('nope'), null);
});
