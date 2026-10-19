'use client';

import { useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { IconCheck, IconCopy, IconSpinner } from '@/components/icons';

export function SubmitButton({
  children,
  className = 'btn btn-primary',
  pendingText,
  name,
  value
}: {
  children: ReactNode;
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? (
        <>
          <IconSpinner />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-icon"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

export function NavLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className={`nav-item${active ? ' active' : ''}`}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

export function Notice({ state }: { state: { ok?: boolean; message?: string } | null }) {
  if (!state?.message) return null;
  return <div className={`notice ${state.ok ? 'ok' : 'err'}`}>{state.message}</div>;
}
