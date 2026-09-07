import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { fileToResizedDataUrl } from '@/lib/images';
import { useAsync } from '@/lib/useAsync';
import {
  createCustomerReviewVideo,
  deleteCustomerReviewVideo,
  listCustomerReviewVideos,
  moveCustomerReviewVideo,
  setCustomerReviewVideoActive,
  updateCustomerReviewVideo,
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

/** Whether a clip's `videoUrl` is a hosted link (has a web preview) rather
 *  than one of the app's bundled asset paths (preview only inside the app). */
function isHostedUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export default function CustomerVideosPage() {
  const { data, loading, error, reload } = useAsync(listCustomerReviewVideos, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewCustomerReviewVideo>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openAdd() {
    setDraft({ ...EMPTY, sort: rows.length });
    setFormError(null);
    setAdding(true);
  }

  function openEdit(video: CustomerReviewVideo) {
    setDraft({
      name: video.name,
      subtitle: video.subtitle,
      videoUrl: video.videoUrl,
      thumbnail: video.thumbnail,
      isActive: video.isActive,
      sort: video.sort,
    });
    setFormError(null);
    setEditingId(video.id);
  }

  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setFormError(null);
  }

  async function handleThumbnailPick(file: File) {
    setFormError(null);
    try {
      const url = await fileToResizedDataUrl(file, 640, 0.75);
      setDraft((d) => ({ ...d, thumbnail: url }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load the image.');
    }
  }

  async function save() {
    if (!draft.name.trim()) {
      setFormError('Give the clip a name.');
      return;
    }
    if (!draft.videoUrl.trim()) {
      setFormError('Add a video URL.');
      return;
    }
    if (!isHostedUrl(draft.videoUrl)) {
      setFormError('The video URL must start with http:// or https://.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await updateCustomerReviewVideo(editingId, draft);
      } else {
        await createCustomerReviewVideo(draft);
      }
      closeForm();
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the clip.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await deleteCustomerReviewVideo(id);
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
      header: 'Source',
      render: (row) =>
        isHostedUrl(row.videoUrl) ? (
          <p className="line-clamp-1 max-w-[16rem] text-xs text-slate-500">
            {row.videoUrl}
          </p>
        ) : (
          <span className="text-xs text-slate-400">Bundled with the app</span>
        ),
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
            {editingId && (
              <Button
                variant="danger"
                disabled={saving}
                onClick={() => remove(editingId)}
              >
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" disabled={saving} onClick={closeForm}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {editingId ? 'Save changes' : 'Add clip'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <EditField label="Video URL">
            <input
              value={draft.videoUrl}
              onChange={(e) =>
                setDraft((d) => ({ ...d, videoUrl: e.target.value }))
              }
              className={inputClass}
              placeholder="https://…/clip.mp4"
            />
            <p className="mt-1 text-xs text-slate-400">
              A direct link to a hosted video file (e.g. Firebase Storage,
              Cloudinary, or any CDN). Played the same on the app and the web
              build.
            </p>
          </EditField>

          <EditField label="Thumbnail (optional)">
            <div className="flex items-center gap-3">
              {draft.thumbnail ? (
                <img
                  src={draft.thumbnail}
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
                  className="text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-brand-50 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-brand-700"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleThumbnailPick(file);
                  }}
                />
                <p className="text-xs text-slate-400">
                  Shown on the card before it plays. Left blank, the app
                  decodes a frame from the video itself.
                </p>
                {draft.thumbnail && (
                  <button
                    type="button"
                    className="self-start text-xs font-medium text-rose-600"
                    onClick={() => setDraft((d) => ({ ...d, thumbnail: '' }))}
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
