/**
 * Pure helpers behind the Lab Orders screen — kept apart from the page so the
 * rules (what a report may be, what can still be edited, how a date crosses a
 * `datetime-local` input) are testable without a browser.
 */

export type LabStatus =
  | 'requested'
  | 'confirmed'
  | 'sample_collected'
  | 'report_ready'
  | 'cancelled';

/** Pages one booking's report may hold. */
export const MAX_REPORT_PAGES = 12;
/** The largest picked file we will even try to read (it is resized after). */
export const MAX_REPORT_FILE_BYTES = 15 * 1024 * 1024;

interface PickedFile {
  name: string;
  type: string;
  size: number;
}

/**
 * Why these picked files cannot be attached as report pages, or null when they
 * can. [existingPages] is how many pages the booking already has.
 *
 * Reports are attached as pictures — a photo or scan of each page — stored
 * like a prescription page and shown in the member's app. A PDF is refused
 * here, in plain words, rather than failing later as "not a readable image".
 */
export function reportFilesProblem(
  files: readonly PickedFile[],
  existingPages: number,
): string | null {
  if (files.length === 0) {
    return 'Pick at least one page.';
  }
  const pdf = files.find(
    (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
  );
  if (pdf) {
    return `${pdf.name} is a PDF. Attach a photo or screenshot of each page instead — PDFs are not supported yet.`;
  }
  const notImage = files.find((f) => !f.type.startsWith('image/'));
  if (notImage) {
    return `${notImage.name} is not an image. Attach a photo or scan of each page (JPG or PNG).`;
  }
  const tooBig = files.find((f) => f.size > MAX_REPORT_FILE_BYTES);
  if (tooBig) {
    return `${tooBig.name} is larger than ${MAX_REPORT_FILE_BYTES / (1024 * 1024)} MB.`;
  }
  if (existingPages + files.length > MAX_REPORT_PAGES) {
    const room = Math.max(0, MAX_REPORT_PAGES - existingPages);
    return `A report holds at most ${MAX_REPORT_PAGES} pages — there is room for ${room} more.`;
  }
  return null;
}

/** Whether the lab can still reschedule a booking in [status]. */
export function canReschedule(status: LabStatus): boolean {
  return status === 'requested' || status === 'confirmed' || status === 'sample_collected';
}

/** Whether the lab can still change the note on a booking in [status]. */
export function canEditNote(status: LabStatus): boolean {
  return status !== 'cancelled';
}

/** Whether pages can be attached: from sample collection onward, never once cancelled. */
export function canAttachReport(status: LabStatus): boolean {
  return status === 'sample_collected' || status === 'report_ready';
}

/**
 * The next step's button is blocked when it would be "Report ready" with no
 * report attached — the member is told a report is waiting, so it must be.
 * Returns the reason, or null when the step may go ahead.
 */
export function nextStepBlocker(
  current: LabStatus,
  reportPages: number,
): string | null {
  if (current === 'sample_collected' && reportPages === 0) {
    return 'Attach the report pages first — the member is told their report is ready.';
  }
  return null;
}

/** Whether removing a page is allowed: a Report-ready booking keeps at least one. */
export function canRemoveReportPage(
  status: LabStatus,
  reportPages: number,
): boolean {
  if (status === 'cancelled') return false;
  return !(status === 'report_ready' && reportPages <= 1);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO timestamp → the local `YYYY-MM-DDTHH:mm` a `datetime-local` input wants. */
export function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value → ISO timestamp, or null when it is blank/invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
