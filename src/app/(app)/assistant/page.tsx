import { env } from '@/lib/env';
import { Chat } from './chat';

export default function AssistantPage() {
  return (
    <>
      <header className="topbar">
        <h1>Assistant</h1>
        <span className="label">{env.aiConfigured() ? env.anthropicModel() : 'Not configured'}</span>
      </header>
      <Chat configured={env.aiConfigured()} />
    </>
  );
}
