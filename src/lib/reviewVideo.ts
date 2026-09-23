/**
 * Pure rules for customer review clips — what can be uploaded, and what a saved
 * `video_url` points at. No imports on purpose, so they can be tested on their own.
 */

/** What the backend accepts as a review clip — keep in step with
 *  `REVIEW_VIDEO_CONTENT_TYPES` in backend/api's catalogue `dto.ts`. */
export const REVIEW_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
/** The hard ceiling. The server's own configured limit (`REVIEW_VIDEO_MAX_MB`,
 *  50 by default) is usually stricter and answers with its own message,
 *  before any upload starts. */
export const MAX_REVIEW_VIDEO_BYTES = 200 * 1024 * 1024;

const TYPE_BY_EXTENSION: Record<string, (typeof REVIEW_VIDEO_TYPES)[number]> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** The content type to upload `file` as, or null when it isn't a supported
 *  video. Trusts the browser's type when it's one we accept, and falls back to
 *  the extension for the files browsers report with no type at all. */
export function reviewVideoContentType(file: File): (typeof REVIEW_VIDEO_TYPES)[number] | null {
  if ((REVIEW_VIDEO_TYPES as readonly string[]).includes(file.type)) {
    return file.type as (typeof REVIEW_VIDEO_TYPES)[number];
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[extension] ?? null;
}

/** Why `file` can't be uploaded as a clip, or null when it's fine. */
export function reviewVideoProblem(file: File): string | null {
  if (!reviewVideoContentType(file)) {
    return 'That isn’t a supported video — use an MP4, WebM or MOV file.';
  }
  if (file.size <= 0) {
    return 'That file is empty.';
  }
  if (file.size > MAX_REVIEW_VIDEO_BYTES) {
    return `That video is ${formatMegabytes(file.size)} — the limit is ${formatMegabytes(MAX_REVIEW_VIDEO_BYTES)}. Compress it first.`;
  }
  return null;
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export type ReviewVideoSource = 'video' | 'youtube' | 'bundled' | 'other';

/** Where a saved `video_url` points, which decides whether the app can play it.
 *  Only 'video' (a hosted file — what an upload produces) plays in the app;
 *  'youtube' and 'bundled' are rows from before uploads existed. */
export function reviewVideoSource(url: string): ReviewVideoSource {
  const trimmed = url.trim();
  if (/^assets\//i.test(trimmed)) return 'bundled';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'other';
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be')) {
      return 'youtube';
    }
    return 'video';
  } catch {
    return 'other';
  }
}
