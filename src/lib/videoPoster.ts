export interface VideoInfo {
  /** A JPEG data URI of an early frame, or null when the browser couldn't decode one. */
  poster: string | null;
  /** Length in seconds, or 0 when unknown. */
  duration: number;
  width: number;
  height: number;
}

/**
 * Reads a picked video file in the browser: its length and size, and a poster
 * frame for the card in the customer's app. The app shows this frame instead of
 * downloading the video just to draw a thumbnail, so it's worth having for
 * every clip. Never rejects — a file the browser can't decode (HEVC in Chrome,
 * say) simply comes back with `poster: null` and the admin picks an image.
 */
export function readVideoInfo(file: File, maxWidth = 480, timeoutMs = 10_000): Promise<VideoInfo> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const finish = (info: Partial<VideoInfo> = {}) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve({ poster: null, duration: 0, width: 0, height: 0, ...info });
    };
    const timer = window.setTimeout(() => finish(), timeoutMs);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish();
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      // A moment in, not frame 0 — the first frame is often black or a fade-in.
      video.currentTime = duration > 0 ? Math.min(1, duration * 0.1) : 0;
    };
    video.onseeked = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const { videoWidth: width, videoHeight: height } = video;
      if (!width || !height) {
        finish({ duration });
        return;
      }
      try {
        const scale = Math.min(1, maxWidth / width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish({ poster: canvas.toDataURL('image/jpeg', 0.75), duration, width, height });
      } catch {
        finish({ duration, width, height });
      }
    };
    video.src = url;
  });
}
