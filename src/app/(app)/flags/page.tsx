import { db } from '@/lib/supabase/admin';
import { timeAgo } from '@/lib/format';
import { unflag } from '@/app/actions';
import { CopyButton, SubmitButton } from '@/components/ui';
import { FlagForm, SanctionsButton } from './flag-forms';
import type { FlaggedAddress } from '@/lib/types';

export default async function FlagsPage() {
  const [manual, sanctionsCount, settings] = await Promise.all([
    db().from('flagged_addresses').select('*').eq('source', 'manual').order('created_at', { ascending: false }),
    db().from('flagged_addresses').select('address', { count: 'exact', head: true }).eq('source', 'sanctions'),
    db().from('settings').select('sanctions_synced_at').eq('id', 1).single()
  ]);
  const flags = (manual.data || []) as FlaggedAddress[];

  return (
    <>
      <header className="topbar">
        <h1>Flags</h1>
      </header>
      <div className="content stack">
        <section className="grid grid-2">
          <div className="panel">
            <div className="panel-head">
              <h2>Flag an address</h2>
            </div>
            <div className="panel-pad">
              <FlagForm />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Sanctions list</h2>
              <span className="label">OFAC · TRON</span>
            </div>
            <div className="panel-pad stack">
              <div className="metric-value" style={{ marginTop: 0 }}>{sanctionsCount.count || 0}</div>
              <div className="faint" style={{ fontSize: 12.5 }}>
                Sanctioned TRON addresses loaded · updated {timeAgo(settings.data?.sanctions_synced_at ?? null)}
              </div>
              <SanctionsButton />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Your flags</h2>
            <span className="label">{flags.length}</span>
          </div>
          {flags.length === 0 ? (
            <div className="panel-pad faint">No flagged addresses. Flag a sender from any transfer report or above.</div>
          ) : (
            <div className="table-wrap" style={{ padding: '12px 16px 8px' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Note</th>
                    <th>Severity</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => (
                    <tr key={f.address}>
                      <td>
                        <div className="row">
                          <span className="mono" style={{ fontSize: 12.5 }}>{f.address}</span>
                          <CopyButton value={f.address} />
                        </div>
                      </td>
                      <td className="muted">{f.label || '—'}</td>
                      <td>
                        <span className={`badge ${f.severity >= 90 ? 'badge-severe' : f.severity >= 70 ? 'badge-high' : 'badge-medium'}`}>
                          {f.severity}
                        </span>
                      </td>
                      <td className="faint" style={{ whiteSpace: 'nowrap' }}>{timeAgo(f.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <form action={unflag}>
                          <input type="hidden" name="address" value={f.address} />
                          <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                            Remove
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
