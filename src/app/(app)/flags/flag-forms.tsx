'use client';

import { useActionState, useEffect, useRef } from 'react';
import { flagAddress, syncSanctionsAction } from '@/app/actions';
import { Notice, SubmitButton } from '@/components/ui';
import { IconRefresh } from '@/components/icons';

export function FlagForm() {
  const [state, action] = useActionState(flagAddress, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="stack">
      <label className="field">
        <span className="label">TRON address</span>
        <input className="input mono" name="address" placeholder="T…" required spellCheck={false} autoComplete="off" />
      </label>
      <label className="field">
        <span className="label">Note</span>
        <input className="input" name="label" placeholder="Scam, chargeback, unknown counterparty…" maxLength={80} />
      </label>
      <label className="field">
        <span className="label">Severity</span>
        <select className="select" name="severity" defaultValue="80">
          <option value="50">Medium — 50</option>
          <option value="80">High — 80</option>
          <option value="100">Severe — 100</option>
        </select>
      </label>
      <div className="row row-wrap">
        <SubmitButton pendingText="Saving">Flag address</SubmitButton>
        <Notice state={state} />
      </div>
    </form>
  );
}

export function SanctionsButton() {
  const [state, action] = useActionState(syncSanctionsAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <div>
        <SubmitButton className="btn btn-ghost btn-sm" pendingText="Updating">
          <IconRefresh /> Update now
        </SubmitButton>
      </div>
      <Notice state={state} />
    </form>
  );
}
