import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';
import { fileToResizedDataUrl } from '@/lib/images';
import { readVideoInfo } from '@/lib/videoPoster';
import { formatMegabytes, reviewVideoProblem, reviewVideoSource } from '@/lib/reviewVideo';
import { useAsync } from '@/lib/useAsync';
import {
  createCustomerReviewVideo,
  deleteCustomerReviewVideo,
  deleteStoredReviewVideo,
  listCustomerReviewVideos,
  moveCustomerReviewVideo,
  requestReviewVideoUpload,
  setCustomerReviewVideoActive,
  updateCustomerReviewVideo,
  uploadReviewVideoFile,
} from '@/api/customerReviewVideos';
import type { CustomerReviewVideo, NewCustomerReviewVideo } from '@/types';

const EMPTY: NewCustomerReviewVideo = {
  name: '',
  subtitle: '',
  videoUrl: '',
  thumbnail: '',
  isActive: true,
  sort: 0,
};

/** A video picked in the form but not uploaded yet — that happens on save. */
interface PickedVideo {
  file: File;
  /** Object URL for the in-form preview; revoked when replaced or the form closes. */
  previewUrl: string;
  /** A frame grabbed from the file, or null when the browser couldn't decode one. */
  poster: string | null;
  duration: number;
}

export default function CustomerVideosPage() {
  const { accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(listCustomerReviewVideos, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewCustomerReviewVideo>(EMPTY);
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [reading, setReading] = useState(false);
  // True once the admin chose a thumbnail image themselves — that beats the
  // frame grabbed from a newly picked video.
  const [thumbnailChosen, setThumbnailChosen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const editingVideo = editingId ? rows.find((r) => r.id === editingId) ?? null : null;
  const savedSource = draft.videoUrl ? reviewVideoSource(draft.videoUrl) : null;
  // What the in-form player shows: the file just picked, else the clip as saved.
  const previewSrc = picked?.previewUrl ?? (savedSource === 'video' ? draft.videoUrl : null);
  const previewPoster = draft.thumbnail || picked?.poster || undefined;

  // Object URLs hold the whole file in memory until revoked.
  useEffect(() => {
    return () => {
      if (picked) URL.revokeObjectURL(picked.previewUrl);
    };
  }, [picked]);

  function resetForm() {
    setPicked(null);
    setReading(false);
    setThumbnailChosen(false);
    setProgress(null);
    setFormError(null);
  }

  function openAdd() {
    resetForm();
    setDraft({ ...EMPTY, sort: rows.length });
    setAdding(true);
  }

  function openEdit(video: CustomerReviewVideo) {
    resetForm();
    setDraft({
      name: video.name,
      subtitle: video.subtitle,
      videoUrl: video.videoUrl,
      thumbnail: video.thumbnail,
      isActive: video.isActive,
      sort: video.sort,
    });
    setEditingId(video.id);
  }

  function closeForm() {
    // Closing mid-upload stops the transfer rather than leaving it running unseen.
    abortRef.current?.abort();
    setAdding(false);
    setEditingId(null);
    resetForm();
  }

  async function handleVideoPick(file: File) {
    setFormError(null);
    const problem = reviewVideoProblem(file);
    if (problem) {
      setFormError(problem);
      return;
    }
    setReading(true);
    const info = await readVideoInfo(file);
    setReading(false);
    setPicked({
      file,
      previewUrl: URL.createObjectURL(file),
      poster: info.poster,
      duration: info.duration,
    });
    // A new video makes the old poster stale — unless the admin picked one just now.
    if (!thumbnailChosen) setDraft((d) => ({ ...d, thumbnail: '' }));
    if (!draft.name.trim()) {
      // A starting point for the caption, not a final answer — the admin can retype it.
      const guess = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      setDraft((d) => (d.name.trim() ? d : { ...d, name: guess }));
    }
  }

  async function handleThumbnailPick(file: File) {
    setFormError(null);
    try {
      const url = await fileToResizedDataUrl(file, 640, 0.75);
      setDraft((d) => ({ ...d, thumbnail: url }));
      setThumbnailChosen(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load the image.');
    }
  }

  async function save() {
    if (!draft.name.trim()) {
      setFormError('Give the clip a name.');
      return;
    }
    if (!picked && savedSource !== 'video') {
      setFormError('Upload a video file for this clip.');
      return;
    }
    if (picked && !accessToken) {
      setFormError('Your session has expired — sign in again to upload.');
      return;
    }

    setSaving(true);
    setFormError(null);
    setProgress(null);
    const abort = new AbortController();
    abortRef.current = abort;
    let uploadedUrl: string | null = null;
    try {
      let videoUrl = draft.videoUrl;
      if (picked) {
        setProgress(0);
        const ticket = await requestReviewVideoUpload(picked.file, accessToken!);
        await uploadReviewVideoFile(ticket, picked.file, setProgress, abort.signal);
        uploadedUrl = ticket.publicUrl;
        videoUrl = ticket.publicUrl;
      }
      const input: NewCustomerReviewVideo = {
        ...draft,
        videoUrl,
        // An admin-chosen image wins; otherwise a new video brings its own frame.
        thumbnail: thumbnailChosen ? draft.thumbnail : picked ? (picked.poster ?? '') : draft.thumbnail,
      };
      if (editingId) {
        await updateCustomerReviewVideo(editingId, input);
      } else {
        await createCustomerReviewVideo(input);
      }
      // The row now points at the new file; the one it replaced is unreferenced.
      if (editingVideo && picked && editingVideo.videoUrl !== videoUrl) {
        void deleteStoredReviewVideo(editingVideo.videoUrl, accessToken).catch(() => undefined);
      }
      closeForm();
      reload();
    } catch (err) {
      // The file made it to storage but the row didn't save: don't leave it orphaned.
      if (uploadedUrl) {
        void deleteStoredReviewVideo(uploadedUrl, accessToken).catch(() => undefined);
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setFormError(describeSaveError(err));
    } finally {
      abortRef.current = null;
      setSaving(false);
      setProgress(null);
    }
  }

  async function remove(video: CustomerReviewVideo) {
    setSaving(true);
    try {
      await deleteCustomerReviewVideo(video.id);
      void deleteStoredReviewVideo(video.videoUrl, accessToken).catch(() => undefined);
      closeForm();
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(video: CustomerReviewVideo) {
    await setCustomerReviewVideoActive(video.id, !video.isActive);
    reload();
  }

  async function move(video: CustomerReviewVideo, direction: 'up' | 'down') {
    await moveCustomerReviewVideo(video.id, direction, rows);
    reload();
  }

  const columns: Column<CustomerReviewVideo>[] = [
    {
      key: 'preview',
      header: '',
      render: (row) =>
        row.thumbnail ? (
          <img
            src={row.thumbnail}
            alt=""
            className="h-12 w-20 rounded-md border border-slate-200 object-cover"
          />
        ) : (
          <div className="grid h-12 w-20 place-items-center rounded-md border border-dashed border-slate-200 text-slate-300">
            <Icon name="banners" className="h-5 w-5" />
          </div>
        ),
    },
    {
      key: 'name',
      header: 'Clip',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name || 'Untitled'}</p>
          {row.subtitle && (
            <p className="line-clamp-1 text-xs text-slate-400">{row.subtitle}</p>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Video',
      render: (row) => {
        const source = reviewVideoSource(row.videoUrl);
        if (source === 'video') return <Badge tone="green">Uploaded</Badge>;
        return (
          // A row from before uploads existed: the app has nothing to play for it.
          <span
            className="text-xs text-amber-600"
            title={row.videoUrl}
          >
            {source === 'youtube'
              ? 'YouTube link — not shown in the app'
              : source === 'bundled'
                ? 'File missing — not shown in the app'
                : 'Not a video — not shown in the app'}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <button onClick={() => toggleActive(row)} className="cursor-pointer">
          <Badge tone={row.isActive ? 'green' : 'gray'}>
            {row.isActive ? 'Active' : 'Hidden'}
          </Badge>
        </button>
      ),
    },
    {
      key: 'order',
      header: 'Order',
      render: (row) => {
        const index = rows.findIndex((v) => v.id === row.id);
        return (
          <div className="flex items-center gap-1">
            <button
              disabled={index <= 0}
              onClick={() => move(row, 'up')}
              className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="Move up"
            >
              <Icon name="chevron-down" className="h-4 w-4 rotate-180" />
            </button>
            <button
              disabled={index >= rows.length - 1}
              onClick={() => move(row, 'down')}
              className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="Move down"
            >
              <Icon name="chevron-down" className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
          Edit
        </Button>
      ),
      className: 'text-right',
    },
  ];

  const formOpen = adding || editingId !== null;
  const needsUpload = savedSource !== null && savedSource !== 'video';

  return (
    <>
      <PageHeader
        title="Customer Videos"
        subtitle='"What our customers have to say" — the video reel on the app and web home screen.'
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Icon name="plus" className="h-4 w-4" /> Add clip
          </Button>
        }
      />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          empty="No customer videos yet."
        />
      </Card>

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingId ? 'Edit clip' : 'Add clip'}
        footer={
          <>
            {editingVideo && (
              <Button
                variant="danger"
                disabled={saving}
                onClick={() => remove(editingVideo)}
              >
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" onClick={closeForm}>
              {saving && progress !== null ? 'Cancel upload' : 'Cancel'}
            </Button>
            <Button variant="primary" disabled={saving || reading} onClick={save}>
              {saving
                ? progress !== null
                  ? `Uploading ${Math.round(progress * 100)}%…`
                  : 'Saving…'
                : editingId
                  ? 'Save changes'
                  : 'Add clip'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <EditField label="Video">
            {previewSrc ? (
              <video
                key={previewSrc}
                src={previewSrc}
                poster={previewPoster}
                controls
                playsInline
                preload="metadata"
                className="mb-2 max-h-64 w-full rounded-lg bg-black object-contain"
              />
            ) : (
              <div className="mb-2 grid h-28 place-items-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
                {reading ? 'Reading the video…' : 'No video yet'}
              </div>
            )}
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov"
              disabled={saving}
              className="text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-brand-50 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-brand-700"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleVideoPick(file);
                e.target.value = '';
              }}
            />
            {picked ? (
              <p className="mt-1 text-xs text-slate-500">
                {picked.file.name} · {formatMegabytes(picked.file.size)}
                {picked.duration > 0 && ` · ${formatDuration(picked.duration)}`} — uploads when
                you save.
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-400">
                A short MP4, WebM or MOV clip — 50 MB by default (the server says if a file is
                over its limit). It’s stored in Supabase and plays inside the app; nothing is sent
                to YouTube.
              </p>
            )}
            {needsUpload && !picked && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This clip is{' '}
                {savedSource === 'youtube' ? 'a YouTube link' : 'a file bundled with an old app version'},
                which the app can’t play any more. Upload the video to bring it back to the reel.
              </p>
            )}
            {saving && progress !== null && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
          </EditField>

          <EditField label="Thumbnail (optional)">
            <div className="flex items-center gap-3">
              {draft.thumbnail || picked?.poster ? (
                <img
                  src={draft.thumbnail || picked?.poster || ''}
                  alt=""
                  className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                />
              ) : (
                <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                  <Icon name="banners" className="h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <input
                  type="file"
                  accept="image/*"
                  disabled={saving}
                  className="text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-brand-50 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-brand-700"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleThumbnailPick(file);
                  }}
                />
                <p className="text-xs text-slate-400">
                  {picked && !picked.poster
                    ? 'This browser couldn’t grab a frame from the video — pick an image for the card.'
                    : 'Shown on the card before it plays. Left as is, a frame from the video is used.'}
                </p>
                {draft.thumbnail && (
                  <button
                    type="button"
                    className="self-start text-xs font-medium text-rose-600"
                    onClick={() => {
                      setDraft((d) => ({ ...d, thumbnail: '' }));
                      setThumbnailChosen(true);
                    }}
                  >
                    Remove thumbnail
                  </button>
                )}
              </div>
            </div>
          </EditField>

          <EditField label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className={inputClass}
              placeholder="Melattur"
            />
          </EditField>

          <EditField label="Caption (optional — shown over the clip)">
            <input
              value={draft.subtitle}
              onChange={(e) =>
                setDraft((d) => ({ ...d, subtitle: e.target.value }))
              }
              className={inputClass}
              placeholder="e.g. A regular at our Melattur store"
            />
          </EditField>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft((d) => ({ ...d, isActive: e.target.checked }))
              }
            />
            Show on the home screen
          </label>

          {formError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A message an admin can act on, for whatever went wrong requesting the
 *  upload, sending the file, or saving the row. */
function describeSaveError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'STORAGE_NOT_CONFIGURED') {
      return 'Video storage isn’t set up on the server yet — see the Supabase setup steps in docs/admin-console.md.';
    }
    if (err.status === 401) return 'Your session has expired — sign in again to upload.';
    if (err.status === 403) return 'Your account isn’t allowed to manage customer videos.';
    return err.message;
  }
  if (err instanceof TypeError) {
    // fetch() rejects with a TypeError when the API itself can't be reached.
    return 'Couldn’t reach the server to start the upload. Check your connection and try again.';
  }
  return err instanceof Error ? err.message : 'Could not save the clip.';
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
