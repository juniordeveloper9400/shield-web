import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { sql } from '@/lib/db';

/**
 * The admin desk's WhatsApp number — what the member apps offer when a member
 * has no store to message yet. Stored in `app.app_setting` (migration 0073),
 * so changing it here reaches the apps without a release. Blank hides the
 * option in the apps.
 */
export function AdminWhatsAppCard() {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    sql`SELECT value FROM app.app_setting WHERE key = 'admin_whatsapp' LIMIT 1`
      .then((rows) => {
        const current = String((rows as { value: unknown }[])[0]?.value ?? '');
        setValue(current);
        setSaved(current);
      })
      .catch(() => setMessage('Could not load the admin WhatsApp number.'));
  }, []);

  async function save() {
    const clean = value.replace(/[^0-9+]/g, '');
    setBusy(true);
    setMessage(null);
    try {
      await sql`
        INSERT INTO app.app_setting (key, value, updated_at)
        VALUES ('admin_whatsapp', ${clean}, now())
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
      `;
      setValue(clean);
      setSaved(clean);
      setMessage('Saved.');
    } catch {
      setMessage('Could not save the admin WhatsApp number.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Admin WhatsApp number</p>
          <p className="mt-1 text-xs text-slate-500">
            The number members see for WhatsApp when they have no store yet, such as
            before registering. Leave it blank to hide that option in the app.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 919876543210"
            className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
          <Button variant="primary" onClick={save} disabled={busy || value === saved}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {message && <p className="mt-2 text-xs text-slate-500">{message}</p>}
    </Card>
  );
}
