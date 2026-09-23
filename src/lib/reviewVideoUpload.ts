export const REVIEW_VIDEO_CHUNK_BYTES = 768 * 1024;

export interface ReviewVideoFile extends Blob {
  name: string;
}

export interface ReviewVideoUploadTransport {
  create(input: { contentType: string; byteLength: number; sha256: string }): Promise<{ id: string; nextChunk: number; chunkSizeBytes: number }>;
  status(id: string): Promise<{ nextChunk: number }>;
  putChunk(id: string, index: number, data: string): Promise<{ nextChunk: number }>;
  complete(id: string): Promise<{ videoUrl: string }>;
  discard(id: string): Promise<void>;
}

export interface UploadedReviewVideo {
  mediaId: string;
  publicUrl: string;
}

export async function uploadReviewVideo(
  file: ReviewVideoFile,
  contentType: string,
  transport: ReviewVideoUploadTransport,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadedReviewVideo> {
  throwIfAborted(signal);
  const bytes = await file.arrayBuffer();
  throwIfAborted(signal);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const created = await transport.create({ contentType, byteLength: file.size, sha256 });
  let index = created.nextChunk;
  const chunkSize = created.chunkSizeBytes || REVIEW_VIDEO_CHUNK_BYTES;
  onProgress(Math.min(1, (index * chunkSize) / file.size));

  try {
    while (index * chunkSize < file.size) {
      throwIfAborted(signal);
      const chunk = new Uint8Array(await file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize)).arrayBuffer());
      try {
        const result = await transport.putChunk(created.id, index, bytesToBase64(chunk));
        index = result.nextChunk;
      } catch (error) {
        if (!isConflict(error)) throw error;
        index = (await transport.status(created.id)).nextChunk;
      }
      onProgress(Math.min(1, (index * chunkSize) / file.size));
    }
    throwIfAborted(signal);
    const completed = await transport.complete(created.id);
    onProgress(1);
    return { mediaId: created.id, publicUrl: completed.videoUrl };
  } catch (error) {
    await transport.discard(created.id).catch(() => undefined);
    throw error;
  }
}

export async function discardReviewVideoMedia(mediaId: string, transport: ReviewVideoUploadTransport): Promise<void> {
  await transport.discard(mediaId);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
}

function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
}
