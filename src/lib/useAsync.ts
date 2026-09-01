import { useCallback, useEffect, useState } from 'react';
import { dbErrorMessage } from './db';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-run the loader (e.g. after a write). */
  reload: () => void;
}

/**
 * Runs `loader` on mount and whenever `deps` change, tracking loading / error
 * and exposing `reload()`. A stale result from a superseded run is discarded.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err) => {
        if (alive) setError(dbErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}
