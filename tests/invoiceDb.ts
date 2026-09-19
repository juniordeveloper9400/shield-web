// A database-boundary double used only by the browser fixture server.
// Invoice components and order APIs are real; no production data is accessed.
export async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return query(strings.join('?'), values);
}

export async function query(sql: string, values: unknown[] = []) {
  const calls = ((window as any).__invoiceQueries ??= []);
  calls.push({ sql, values });
  if ((window as any).__failCompletion && sql.includes("SET status = 'DELIVERED'")) {
    throw new Error('Simulated completion failure');
  }
  if (sql.includes("SET status = 'DELIVERED'")) return [{ id: 42 }];
  if (sql.includes('INSERT INTO app.bill')) return [{ id: 17, sent_at: '2026-09-19T12:30:00Z' }];
  if (sql.includes('AS balance')) return [{ balance: 0 }];
  if (sql.includes('AS total')) return [{ total: 0 }];
  return [];
}
