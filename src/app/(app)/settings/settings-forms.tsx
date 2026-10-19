'use client';

import { useActionState, useState } from 'react';
import { createAccessCode, saveSettings, sendTestEmail } from '@/app/actions';
import { CopyText } from '@/components/reason-list';
import { Notice, SubmitButton } from '@/components/ui';
import type { Settings } from '@/lib/types';

export function SettingsForm({ settings, deepAvailable }: { settings: Settings; deepAvailable: boolean }) {
  const [state, action] = useActionState(saveSettings, null);
  const [mode, setMode] = useState(settings.alert_mode);

  return (
    <form action={action} className="stack" style={{ gap: 20 }}>
      <div className="form-grid">
        <label className="field">
          <span className="label">Email alerts</span>
          <select className="select" name="alert_mode" value={mode} onChange={(e) => setMode(e.target.value as Settings['alert_mode'])}>
            <option value="all">Every transfer</option>
            <option value="risk">Only risky transfers</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="field" style={{ opacity: mode === 'risk' ? 1 : 0.45 }}>
          <span className="label">Alert from level</span>
          <select className="select" name="alert_min_level" defaultValue={settings.alert_min_level} disabled={mode !== 'risk'}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="severe">Severe</option>
          </select>
          {mode !== 'risk' ? <input type="hidden" name="alert_min_level" value={settings.alert_min_level} /> : null}
        </label>
        <label className="field">
          <span className="label">Ignore below</span>
          <input className="input tnum" type="number" name="min_amount" min="0" step="0.01" defaultValue={settings.min_amount} />
          <span className="field-hint">Hides dust and address-poisoning spam</span>
        </label>
      </div>

      <div className="form-grid">
        <div className="field">
          <span className="label">Deep screening</span>
          <label className="check" style={{ height: 40, opacity: deepAvailable ? 1 : 0.45 }}>
            <input type="checkbox" name="deep_check_enabled" defaultChecked={settings.deep_check_enabled} disabled={!deepAvailable} />
            <span className="muted" style={{ fontSize: 13 }}>{deepAvailable ? 'Enabled for large amounts' : 'Provider not configured'}</span>
          </label>
        </div>
        <label className="field">
          <span className="label">Large amount from</span>
          <input className="input tnum" type="number" name="deep_check_threshold" min="0" step="1" defaultValue={settings.deep_check_threshold} />
          <span className="field-hint">Triggers deep screening and the large-amount signal</span>
        </label>
        <label className="field">
          <span className="label">Re-screen after (hours)</span>
          <input className="input tnum" type="number" name="cache_hours" min="1" max="168" defaultValue={settings.cache_hours} />
          <span className="field-hint">Known senders reuse results within this window</span>
        </label>
      </div>

      <div className="row row-wrap">
        <SubmitButton pendingText="Saving">Save settings</SubmitButton>
        <Notice state={state} />
      </div>
    </form>
  );
}

export function TestEmailButton() {
  const [state, action] = useActionState(sendTestEmail, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <div>
        <SubmitButton className="btn btn-ghost btn-sm" pendingText="Sending">
          Send test email
        </SubmitButton>
      </div>
      <Notice state={state} />
    </form>
  );
}

export function NewAccessCodeForm() {
  const [state, action] = useActionState(createAccessCode, null);
  return (
    <form action={action} className="stack">
      <div className="row row-wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span className="label">Label</span>
          <input className="input" name="label" placeholder="e.g. Phone, Laptop, Partner" maxLength={40} />
        </label>
        <SubmitButton className="btn btn-ghost" pendingText="Creating">
          Create access code
        </SubmitButton>
      </div>
      {state?.code ? (
        <div className="addr-box">
          <span className="label">New code · shown once</span>
          <div className="addr-full mono" style={{ fontSize: 18, letterSpacing: '.06em' }}>{state.code}</div>
          <div className="row row-wrap">
            <CopyText value={state.code} label="Copy code" />
          </div>
        </div>
      ) : null}
      <Notice state={state} />
    </form>
  );
}
