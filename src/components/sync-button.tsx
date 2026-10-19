'use client';

import { useActionState, useEffect, useState } from 'react';
import { syncNow } from '@/app/actions';
import { SubmitButton } from '@/components/ui';
import { IconRefresh } from '@/components/icons';

export function SyncButton() {
  const [state, action] = useActionState(syncNow, null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!state?.message) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <form action={action} className="row">
      {visible && state?.message ? (
        <span className="faint" style={{ fontSize: 12, color: state.ok ? undefined : 'var(--red-fg)' }}>
          {state.message}
        </span>
      ) : null}
      <SubmitButton className="btn btn-ghost btn-sm" pendingText="Syncing">
        <IconRefresh /> Sync now
      </SubmitButton>
    </form>
  );
}
