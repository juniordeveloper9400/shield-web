import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  REVIEW_VIDEO_CHUNK_BYTES,
  discardReviewVideoMedia,
  uploadReviewVideo,
} from '../src/lib/reviewVideoUpload.ts';

/** A real File-like Blob, large enough to span several chunks. */
function fileOf(byteLength) {
  const bytes = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i++) bytes[i] = i % 256;
  return new File([bytes], 'clip.mp4', { type: 'video/mp4' });
}

const sha256Of = (file) =>
  file.arrayBuffer().then((buf) => createHash('sha256').update(Buffer.from(buf)).digest('hex'));

/** A conflict the way ApiError actually shapes one — `status` is what
 *  `uploadReviewVideo`'s own `isConflict` checks. */
class FakeConflict extends Error {
  constructor() {
    super('Video chunks must be uploaded in order.');
    this.status = 409;
  }
}

/** Records every call and behaves like the real backend: one media row,
 *  chunks appended in order, complete only once every byte has arrived. */
function fakeTransport(overrides = {}) {
  const calls = { create: 0, putChunk: [], status: 0, complete: 0, discard: [] };
  let stored = 0;
  let declaredLength = 0;
  return {
    calls,
    async create(input) {
      calls.create++;
      declaredLength = input.byteLength;
      stored = 0;
      return { id: 'media-1', nextChunk: 0, chunkSizeBytes: REVIEW_VIDEO_CHUNK_BYTES, ...overrides.create };
    },
    async status() {
      calls.status++;
      const nextChunk = Math.ceil(stored / REVIEW_VIDEO_CHUNK_BYTES);
      return { nextChunk };
    },
    async putChunk(id, index, data) {
      calls.putChunk.push(index);
      if (overrides.putChunk) return overrides.putChunk(id, index, data, calls.putChunk.length - 1);
      const bytes = Buffer.from(data, 'base64');
      stored += bytes.length;
      return { nextChunk: Math.ceil(stored / REVIEW_VIDEO_CHUNK_BYTES) };
    },
    async complete() {
      calls.complete++;
      assert.equal(stored, declaredLength, 'complete() called before every byte arrived');
      return { videoUrl: '/v1/public/catalogue/review-video-media/media-1' };
    },
    async discard(id) {
      calls.discard.push(id);
    },
  };
}

test('splits a file into 786432-byte chunks, in order, with the server-declared size', async () => {
  const file = fileOf(REVIEW_VIDEO_CHUNK_BYTES * 2 + 100);
  const transport = fakeTransport();

  await uploadReviewVideo(file, 'video/mp4', transport, () => {});

  assert.deepEqual(transport.calls.putChunk, [0, 1, 2]);
  assert.equal(transport.calls.complete, 1);
});

test('computes the file\'s SHA-256 as lowercase hex, matching Node\'s own digest', async () => {
  const file = fileOf(1000);
  const expected = await sha256Of(file);
  let sentSha256 = null;
  const transport = fakeTransport();
  const realCreate = transport.create.bind(transport);
  transport.create = async (input) => {
    sentSha256 = input.sha256;
    return realCreate(input);
  };

  await uploadReviewVideo(file, 'video/mp4', transport, () => {});

  assert.equal(sentSha256, expected);
  assert.equal(sentSha256, sentSha256.toLowerCase());
});

test('resumes from the chunk the server actually has on a 409, rather than restarting', async () => {
  // Exactly two chunks. The second PUT's bytes genuinely land on the server
  // (the fake really appends them, so complete()'s byte-count check is
  // meaningful) but the client never sees that response as a success — a
  // retry ambiguity, the case a 409 exists to resolve.
  const file = fileOf(REVIEW_VIDEO_CHUNK_BYTES * 2);
  const transport = fakeTransport();
  const realPutChunk = transport.putChunk.bind(transport);
  transport.putChunk = async (id, index, data) => {
    if (index === 1) {
      await realPutChunk(id, index, data);
      throw new FakeConflict();
    }
    return realPutChunk(id, index, data);
  };
  // status() reports the true position after that conflict: both chunks are
  // in fact already stored, so the upload should go straight to complete().
  transport.status = async () => {
    transport.calls.status++;
    return { nextChunk: 2 };
  };

  const result = await uploadReviewVideo(file, 'video/mp4', transport, () => {});

  assert.deepEqual(transport.calls.putChunk, [0, 1]); // never re-sent as chunk 1 again
  assert.equal(transport.calls.status, 1);
  assert.equal(transport.calls.complete, 1);
  assert.equal(result.mediaId, 'media-1');
  assert.equal(result.publicUrl, '/v1/public/catalogue/review-video-media/media-1');
});

test('reports monotonically increasing progress, ending at exactly 1', async () => {
  const file = fileOf(REVIEW_VIDEO_CHUNK_BYTES * 3);
  const transport = fakeTransport();
  const seen = [];

  await uploadReviewVideo(file, 'video/mp4', transport, (fraction) => seen.push(fraction));

  assert.ok(seen.length >= 4); // one per chunk, plus the final 1
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `progress went backwards: ${seen[i - 1]} -> ${seen[i]}`);
  }
  assert.equal(seen.at(-1), 1);
});

test('completes only once every chunk has been accepted, never before', async () => {
  const file = fileOf(REVIEW_VIDEO_CHUNK_BYTES + 1);
  const transport = fakeTransport();

  const result = await uploadReviewVideo(file, 'video/mp4', transport, () => {});

  assert.equal(transport.calls.putChunk.length, 2);
  assert.equal(transport.calls.complete, 1);
  assert.equal(result.mediaId, 'media-1');
});

test('cancelling mid-upload discards the incomplete media and rejects with AbortError', async () => {
  const file = fileOf(REVIEW_VIDEO_CHUNK_BYTES * 4);
  const controller = new AbortController();
  const transport = fakeTransport();
  const realPutChunk = transport.putChunk.bind(transport);
  transport.putChunk = async (id, index, data) => {
    const result = await realPutChunk(id, index, data);
    if (index === 0) controller.abort(); // cancel right after the first chunk lands
    return result;
  };

  await assert.rejects(
    uploadReviewVideo(file, 'video/mp4', transport, () => {}, controller.signal),
    (error) => error.name === 'AbortError',
  );

  assert.deepEqual(transport.calls.discard, ['media-1']);
  assert.equal(transport.calls.complete, 0);
});

test('a failed cleanup after a real error surfaces the original error, not the cleanup failure', async () => {
  const file = fileOf(REVIEW_VIDEO_CHUNK_BYTES);
  const transport = fakeTransport({
    putChunk: async () => {
      throw new Error('network dropped mid-chunk');
    },
  });
  transport.discard = async () => {
    throw new Error('discard also failed');
  };

  await assert.rejects(
    uploadReviewVideo(file, 'video/mp4', transport, () => {}),
    (error) => error.message === 'network dropped mid-chunk',
  );
});

test('discardReviewVideoMedia just forwards to the transport', async () => {
  const transport = fakeTransport();
  await discardReviewVideoMedia('media-9', transport);
  assert.deepEqual(transport.calls.discard, ['media-9']);
});
