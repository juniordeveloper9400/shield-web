/**
 * Reads a picked image file, scales it so the longest side is at most [max] px,
 * and returns a JPEG data URI — small enough to store in a `text` column
 * (`app.product.image`, `app.home_banner.image`, …) and render straight from
 * `<img src>` in the console, the app, and the web build.
 *
 * JPEG has no alpha channel, so a cut-out (transparent PNG) picked here would
 * come back on a black background. Pass `keepTransparency` for artwork that is
 * drawn on a tinted card — the category chips and sub-category tiles — and it
 * is encoded as WebP instead (small, alpha-capable, and decoded natively by
 * Flutter on Android, iOS and web), or PNG on a browser whose canvas cannot
 * encode WebP.
 */
export function fileToResizedDataUrl(
  file: File,
  max = 640,
  quality = 0.72,
  keepTransparency = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas is unavailable.'));
        ctx.drawImage(img, 0, 0, w, h);
        if (keepTransparency) {
          // A canvas that cannot encode WebP silently returns PNG, which
          // keeps the alpha channel too — just larger.
          resolve(canvas.toDataURL('image/webp', quality));
          return;
        }
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
