'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addWallet } from '@/app/actions';
import { Notice, SubmitButton } from '@/components/ui';

export function AddWalletForm({ nextLabel }: { nextLabel: string }) {
  const [state, action] = useActionState(addWallet, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="stack">
      <div className="form-grid">
        <label className="field">
          <span className="label">Label</span>
          <input className="input" name="label" defaultValue={nextLabel} required maxLength={40} />
        </label>
        <label className="field">
          <span className="label">TRON address</span>
          <input className="input mono" name="address" placeholder="T…" required spellCheck={false} autoComplete="off" />
        </label>
        <label className="field">
          <span className="label">History</span>
          <select className="select" name="backfill" defaultValue="7">
            <option value="0">From now</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </label>
      </div>
      <div className="row row-wrap">
        <SubmitButton pendingText="Adding">Add wallet</SubmitButton>
        <Notice state={state} />
      </div>
    </form>
  );
}
