import { getSettings } from '@/lib/signals';
import { deepCheckConfigured } from '@/lib/amlbot';
import { env } from '@/lib/env';
import { ClearHistoryButton, NewAccessCodeForm, SettingsForm, TestEmailButton } from './settings-forms';
import { db } from '@/lib/supabase/admin';
import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { revokeAccessCode } from '@/app/actions';
import { SubmitButton } from '@/components/ui';
import { timeAgo } from '@/lib/format';

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const current = user.id;
  const [settings, codesRes] = await Promise.all([
    getSettings(user.id),
    user.isAdmin
      ? db().from('access_codes').select('id, label, created_at, last_used_at').is('revoked_at', null).order('created_at')
      : Promise.resolve({ data: [] as unknown[] })
  ]);
  const codes = (codesRes.data || []) as { id: string; label: string; created_at: string; last_used_at: string | null }[];
  const status = [
    { label: 'AI assistant (Claude)', ok: env.aiConfigured(), hint: `Model ${env.anthropicModel()}` },
    { label: 'TronGrid API key', ok: !!env.trongridKey(), hint: 'Higher rate limits for monitoring' },
    { label: 'Email alerts (Resend)', ok: !!env.resendKey(), hint: settings.alert_email ? `Alerts go to ${settings.alert_email}` : 'Set your alert email above' },
    { label: 'Deep screening', ok: deepCheckConfigured(), hint: 'Optional paid provider for large amounts' },
    { label: 'App URL', ok: !!env.appUrl(), hint: 'Used for links in alert emails' }
  ];

  return (
    <>
      <header className="topbar">
        <h1>Settings</h1>
      </header>
      <div className="content stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Alerts and screening</h2>
          </div>
          <div className="panel-pad">
            <SettingsForm settings={settings} deepAvailable={deepCheckConfigured()} />
          </div>
        </section>

        <section className="grid grid-2">
          <div className="panel">
            <div className="panel-head">
              <h2>Connections</h2>
            </div>
            <div className="panel-pad stack" style={{ gap: 12 }}>
              {status.map((s) => (
                <div key={s.label} className="row spread">
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{s.label}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{s.hint}</div>
                  </div>
                  <span className={`badge ${s.ok ? 'badge-low' : 'badge-neutral'}`}>
                    <span className="dot" />
                    {s.ok ? 'Connected' : 'Not set'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Test alert</h2>
            </div>
            <div className="panel-pad stack">
              <div className="faint" style={{ fontSize: 13 }}>
                Sends a sample alert with clearly marked test data to {settings.alert_email || 'your alert email (not set)'}.
              </div>
              <TestEmailButton />
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>History</h2>
            <span className="label">{user.label}</span>
          </div>
          <div className="panel-pad stack">
            <div className="faint" style={{ fontSize: 13 }}>
              Permanently deletes your checks, received transfers and screened addresses. Wallets, flags and settings stay. Other access codes are not affected.
            </div>
            <ClearHistoryButton />
          </div>
        </section>
        {user.isAdmin ? (
        <section className="panel">
            <div className="panel-head">
              <h2>Private access</h2>
              <span className="label">{codes.length} active code{codes.length === 1 ? '' : 's'}</span>
            </div>
            <div className="panel-pad stack">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Created</th>
                      <th>Last used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.label}
                          {c.id === current ? <span className="badge badge-low" style={{ marginLeft: 8 }}>This device</span> : null}
                        </td>
                        <td className="faint">{timeAgo(c.created_at)}</td>
                        <td className="faint">{timeAgo(c.last_used_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {c.id === current ? null : (
                            <form action={revokeAccessCode}>
                              <input type="hidden" name="id" value={c.id} />
                              <SubmitButton className="btn btn-danger btn-sm" pendingText="…">
                                Revoke
                              </SubmitButton>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <NewAccessCodeForm />
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
