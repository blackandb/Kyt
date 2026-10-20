import Link from 'next/link';
import { Suspense } from 'react';
import { db } from '@/lib/supabase/admin';
import { requireOwner } from '@/lib/auth';
import { deepCheckConfigured } from '@/lib/amlbot';
import { timeAgo, shortAddress, shortHash } from '@/lib/format';
import { CheckForm } from './check-form';

export default async function CheckPage() {
  const owner = await requireOwner();
  const { data } = await db()
    .from('manual_checks')
    .select('id, query, kind, result, created_at')
    .eq('owner_id', owner)
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <>
      <header className="topbar">
        <h1>Check</h1>
      </header>
      <div className="content stack">
        <Suspense fallback={null}>
          <CheckForm deepAvailable={deepCheckConfigured()} />
        </Suspense>

        {data && data.length > 0 ? (
          <section className="panel">
            <div className="panel-head">
              <h2>Recent checks</h2>
            </div>
            <div className="table-wrap" style={{ padding: '12px 16px 8px' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Type</th>
                    <th>Result</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => {
                    const r = c.result as { risk?: { score: number; level: string }; transfers?: { sender: { risk: { score: number; level: string } } }[] };
                    const risk = r.risk ?? r.transfers?.[0]?.sender.risk;
                    return (
                      <tr key={c.id}>
                        <td className="mono" style={{ fontSize: 12.5 }}>
                          <Link className="recheck" href={`/check?q=${encodeURIComponent(c.query)}`} title="Run this check again">
                            {c.kind === 'address' ? shortAddress(c.query, 8, 6) : shortHash(c.query)}
                          </Link>
                        </td>
                        <td className="faint">{c.kind}</td>
                        <td>
                          {risk ? (
                            <span className={`badge badge-${risk.level}`}>
                              <span className="dot" />
                              {risk.level} · {risk.score}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="faint" style={{ whiteSpace: 'nowrap' }}>{timeAgo(c.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
