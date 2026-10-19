'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { KytStatus, RiskBadge } from '@/components/risk';
import { ObjectTile } from '@/components/object-tile';
import { shortAddress, shortHash, formatAmount } from '@/lib/format';
import type { CheckResult, AddressReport } from '@/lib/check';

type Msg = { role: 'user' | 'assistant'; content: string; checks?: CheckResult[]; error?: boolean };

const STORE = 'kyt-chat-v2';
const SUGGESTIONS = [
  'Any risky transfers in the last 7 days?',
  'Summary of funds received in the last 24 hours',
  'Check address TEPKBVgweaxWWcKV7d9qVSqFdztiQfGEQp',
  'What is the status of my wallets?'
];

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let list: string[] = [];
  let ordered = false;
  const flush = () => {
    if (!list.length) return;
    const items = list.map((l, i) => <li key={i}>{inline(l)}</li>);
    blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const isOrdered = !!num;
      if (list.length && isOrdered !== ordered) flush();
      ordered = isOrdered;
      list.push((bullet || num)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<p key={blocks.length} className="md-h">{inline(h[1])}</p>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

function AddressChip({ r, label }: { r: AddressReport; label?: string }) {
  const issues = r.risk.reasons.filter((x) => x.tone === 'bad' || x.tone === 'warn').slice(0, 3);
  return (
    <div className="chat-card" data-level={r.risk.level}>
      <div className="row spread row-wrap" style={{ gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          {label ? <div className="label" style={{ marginBottom: 4 }}>{label}</div> : null}
          <a className="mono" style={{ fontSize: 12.5 }} href={`https://tronscan.org/#/address/${r.address}`} target="_blank" rel="noreferrer">
            {shortAddress(r.address, 8, 6)}
          </a>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <KytStatus passed={r.risk.passed} />
          <RiskBadge level={r.risk.level} score={r.risk.score} />
        </div>
      </div>
      {issues.length ? (
        <ul className="chat-reasons">
          {issues.map((i) => (
            <li key={i.code} className={i.tone}>{i.label}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CheckCards({ checks }: { checks: CheckResult[] }) {
  return (
    <div className="stack" style={{ gap: 8, marginTop: 10 }}>
      {checks.map((c, i) => {
        if (c.kind === 'address') return <AddressChip key={i} r={c} />;
        if (c.kind === 'transaction')
          return (
            <div key={i} className="stack" style={{ gap: 8 }}>
              {c.transfers.map((t, j) => (
                <AddressChip
                  key={j}
                  r={t.sender}
                  label={`${t.known ? formatAmount(t.amount) : t.amount} ${t.token} · tx ${shortHash(c.hash, 6, 6)}`}
                />
              ))}
            </div>
          );
        return null;
      })}
    </div>
  );
}

export function Chat({ configured }: { configured: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage unavailable */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, [input]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '—', checks: data.checks }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Request failed', error: true }]);
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  return (
    <div className="chat">
      <div className="chat-scroll">
        <div className="chat-inner">
          {messages.length === 0 ? (
            <div className="empty" style={{ paddingTop: 40 }}>
              <ObjectTile size="md" />
              <h3>Ask about any address or transfer</h3>
              <p>Paste an address or a transaction hash, or ask about your recent transfers.</p>
              {!configured ? (
                <div className="notice err" style={{ marginTop: 8 }}>Add ANTHROPIC_API_KEY in Vercel to enable the assistant.</div>
              ) : (
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="chip" type="button" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="bubble-user" dir="auto">{m.content}</div>
              ) : (
                <div key={i} className={`bubble-ai${m.error ? ' err' : ''}`} dir="auto">
                  <Markdown text={m.content} />
                  {m.checks?.length ? <CheckCards checks={m.checks} /> : null}
                </div>
              )
            )
          )}
          {busy ? (
            <div className="bubble-ai typing" aria-label="Thinking">
              <span /><span /><span />
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="chat-box">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            dir="auto"
            placeholder={configured ? 'Paste an address, a tx hash, or ask a question…' : 'Assistant not configured'}
            disabled={!configured}
            spellCheck={false}
          />
          <div className="row" style={{ gap: 6 }}>
            {messages.length ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMessages([])} disabled={busy}>
                Clear
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary btn-sm" disabled={!configured || busy || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
