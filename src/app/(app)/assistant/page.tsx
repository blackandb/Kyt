import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { requireOwner } from '@/lib/auth';
import { Chat } from './chat';

export default async function AssistantPage() {
  const owner = await requireOwner();
  const userKey = createHash('sha256').update(owner).digest('hex').slice(0, 10);
  return (
    <>
      <header className="topbar">
        <h1>Assistant</h1>
        <span className="label">{env.aiConfigured() ? env.anthropicModel() : 'Not configured'}</span>
      </header>
      <Chat configured={env.aiConfigured()} userKey={userKey} />
    </>
  );
}
