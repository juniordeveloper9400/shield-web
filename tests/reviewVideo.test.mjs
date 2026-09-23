import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REVIEW_VIDEO_BYTES,
  formatMegabytes,
  reviewVideoContentType,
  reviewVideoProblem,
  reviewVideoSource,
} from '../src/lib/reviewVideo.ts';

const file = (name, type, size = 1000) => ({ name, type, size });

test('accepts mp4, webm and mov by type, and by extension when the browser reports no type', () => {
  assert.equal(reviewVideoContentType(file('a.mp4', 'video/mp4')), 'video/mp4');
  assert.equal(reviewVideoContentType(file('a.webm', 'video/webm')), 'video/webm');
  assert.equal(reviewVideoContentType(file('a.mov', 'video/quicktime')), 'video/quicktime');
  assert.equal(reviewVideoContentType(file('clip.MOV', '')), 'video/quicktime');
  assert.equal(reviewVideoContentType(file('clip.m4v', '')), 'video/mp4');
  assert.equal(reviewVideoContentType(file('clip.mp4', 'application/octet-stream')), 'video/mp4');
});

test('rejects anything that is not a supported video', () => {
  assert.equal(reviewVideoContentType(file('a.avi', 'video/x-msvideo')), null);
  assert.equal(reviewVideoContentType(file('a.png', 'image/png')), null);
  assert.equal(reviewVideoContentType(file('noextension', '')), null);
  assert.match(reviewVideoProblem(file('a.png', 'image/png')), /MP4, WebM or MOV/);
});

test('enforces the size limit the backend signs against', () => {
  assert.equal(reviewVideoProblem(file('a.mp4', 'video/mp4', 5_000_000)), null);
  assert.equal(reviewVideoProblem(file('a.mp4', 'video/mp4', MAX_REVIEW_VIDEO_BYTES)), null);
  assert.match(reviewVideoProblem(file('a.mp4', 'video/mp4', MAX_REVIEW_VIDEO_BYTES + 1)), /limit is 200 MB/);
  assert.match(reviewVideoProblem(file('a.mp4', 'video/mp4', 0)), /empty/);
});

test('formats sizes for humans', () => {
  assert.equal(formatMegabytes(1.5 * 1024 * 1024), '1.5 MB');
  assert.equal(formatMegabytes(42 * 1024 * 1024), '42 MB');
});

test('tells an uploaded clip from the old rows the app cannot play', () => {
  assert.equal(reviewVideoSource('https://media.example.com/review-videos/abc.mp4'), 'video');
  assert.equal(reviewVideoSource('https://pub-abc.r2.dev/review-videos/abc.webm'), 'video');
  assert.equal(reviewVideoSource('https://www.youtube.com/shorts/dvLRFi4zBWk?feature=share'), 'youtube');
  assert.equal(reviewVideoSource('https://youtu.be/dvLRFi4zBWk'), 'youtube');
  assert.equal(reviewVideoSource('assets/reviews/tirur_store.mp4'), 'bundled');
  assert.equal(reviewVideoSource(''), 'other');
  assert.equal(reviewVideoSource('not a url'), 'other');
  assert.equal(reviewVideoSource('ftp://example.com/a.mp4'), 'other');
});
