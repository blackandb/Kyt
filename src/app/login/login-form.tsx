'use client';

import { useActionState } from 'react';
import { sendMagicLink } from '@/app/actions';
import { Notice, SubmitButton } from '@/components/ui';

export function LoginForm() {
  const [state, action] = useActionState(sendMagicLink, null);
  return (
    <form action={action}>
      <input className="input" type="email" name="email" placeholder="you@example.com" autoComplete="email" required />
      <SubmitButton className="btn btn-primary" pendingText="Sending">
        Send sign-in link
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}
