import { getSettings } from '@/lib/signals';
import { deepCheckConfigured } from '@/lib/amlbot';
import { env } from '@/lib/env';
import { AccessCodeForm, SettingsForm, TestEmailButton } from './settings-forms';

export default async function SettingsPage() {
  const settings = await getSettings();
  const status = [
    { label: 'AI assistant (Claude)', ok: env.aiConfigured(), hint: `Model ${env.anthropicModel()}` },
    { label: 'TronGrid API key', ok: !!env.trongridKey(), hint: 'Higher rate limits for monitoring' },
    { label: 'Email alerts (Resend)', ok: !!env.resendKey(), hint: env.ownerEmail() ? `Alerts go to ${env.ownerEmail()}` : 'Set OWNER_EMAIL to receive alerts' },
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
                Sends a sample alert with clearly marked test data to {env.ownerEmail() || 'OWNER_EMAIL (not set)'}.
              </div>
              <TestEmailButton />
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Private access</h2>
            <span className="label">Access code</span>
          </div>
          <div className="panel-pad">
            <AccessCodeForm />
          </div>
        </section>
      </div>
    </>
  );
}
