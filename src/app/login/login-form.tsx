'use client';

import { useActionState } from 'react';
import { unlock } from '@/app/actions';
import { Notice, SubmitButton } from '@/components/ui';

export function LoginForm() {
  const [state, action] = useActionState(unlock, null);
  return (
    <form action={action}>
      <input
        className="input access-input"
        type="password"
        name="code"
        placeholder="Private Access"
        aria-label="Private access code"
        autoComplete="current-password"
        autoFocus
        required
      />
      <SubmitButton className="btn btn-primary" pendingText="Verifying">
        Enter
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}
