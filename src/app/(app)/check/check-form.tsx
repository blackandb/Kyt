'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CopyButton } from '@/components/ui';
import { KytStatus, RiskBadge } from '@/components/risk';
import { AddressActions, CopyText, ReasonList } from '@/components/reason-list';
import { IconExternal, IconSearch } from '@/components/icons';
import { formatAmount, shortHash } from '@/lib/format';
import type { AddressReport, CheckResult } from '@/lib/check';
import type { CheckStep, RiskLevel, StepState } from '@/lib/types';

const TRONSCAN = 'https://tronscan.org/#';
const STEP_GAP_MS = 150;

type Kind = 'address' | 'transaction' | 'invalid' | 'empty';
type Row = CheckStep & { pending?: boolean; skipped?: boolean; seq: number };
type Phase = 'idle' | 'running' | 'done' | 'error';

const ADDRESS_PLAN: { id: string; label: string }[] = [
  { id: 'format', label: 'Address format & checksum' },
  { id: 'sanctions', label: 'OFAC sanctions list' },
  { id: 'flags', label: 'Your flagged addresses' },
  { id: 'poisoning', label: 'Address-poisoning lookalikes' },
  { id: 'tether', label: 'Tether USDT blacklist' },
  { id: 'account', label: 'Account age' },
  { id: 'activity', label: 'Transfer history' },
  { id: 'trace1', label: 'Fund trace · direct sources' },
  { id: 'trace2', label: 'Fund trace · second step' },
  { id: 'score', label: 'Risk score' }
];

function detect(q: string): Kind {
  const v = q.trim();
  if (!v) return 'empty';
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) return 'address';
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(v)) return 'transaction';
  return 'invalid';
}

const RING_COLOR: Record<RiskLevel, string> = {
  low: 'var(--green-fg)',
  medium: 'var(--amber-fg)',
  high: 'var(--orange-fg)',
  severe: 'var(--red-fg)'
};

function AnimatedRing({ score, level, size = 116 }: { score: number; level: RiskLevel; size?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(score);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 1200;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(score * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - shown / 100);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={RING_COLOR[level]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="num">
        <b className="tnum">{shown}</b>
        <span className="label">Score</span>
      </div>
    </div>
  );
}

function StepIcon({ state, pending, skipped }: { state: StepState; pending?: boolean; skipped?: boolean }) {
  if (pending) return <span className="sx sx-pending" />;
  if (skipped) return <span className="sx sx-skip">–</span>;
  if (state === 'run') return <span className="sx sx-run" />;
  const glyph = state === 'ok' ? '✓' : state === 'bad' ? '✕' : state === 'warn' ? '!' : 'i';
  return <span className={`sx sx-${state}`}>{glyph}</span>;
}

function StepRow({ row }: { row: Row }) {
  return (
    <div className={`step${row.pending ? ' is-pending' : ''}${row.state === 'run' && !row.pending ? ' is-run' : ''}${row.skipped ? ' is-skip' : ''}`}>
      <StepIcon state={row.state} pending={row.pending} skipped={row.skipped} />
      <div className="step-body">
        <div className="step-label">{row.label}</div>
        {row.detail && !row.pending ? (
          <div className="step-detail" key={row.detail}>
            {row.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const HIT_LABEL = { tether_blacklist: 'Frozen by Tether', sanctions: 'Sanctioned', flagged: 'Flagged by you' } as const;

function reportText(r: AddressReport): string {
  const s = r.signals;
  const lines = [
    `KYT check — ${r.address}`,
    `Result: ${r.risk.level.toUpperCase()} · score ${r.risk.score} · KYT ${r.risk.passed ? 'passed' : 'failed'}`,
    `Checked: ${new Date(r.checkedAt || Date.now()).toLocaleString('en-GB')}`,
    '',
    'Reasons:',
    ...r.risk.reasons.map((x) => `- ${x.label}${x.weight ? ` (+${x.weight})` : ''}${x.address ? `\n  ${x.address}` : ''}`)
  ];
  if (s.trace?.hits.length) {
    lines.push('', 'Fund trace findings:');
    s.trace.hits.forEach((h) =>
      lines.push(`- Step ${h.hop} · ${HIT_LABEL[h.reason]}: ${h.address}${h.via ? `\n  via ${h.via}` : ''}`)
    );
  }
  lines.push('', `https://tronscan.org/#/address/${r.address}`);
  return lines.join('\n');
}

function TraceFindings({ r }: { r: AddressReport }) {
  const hits = r.signals.trace?.hits ?? [];
  const [open, setOpen] = useState<number | null>(hits.length === 1 ? 0 : null);
  if (!hits.length) return null;
  return (
    <div className="findings">
      <div className="label" style={{ marginBottom: 8 }}>
        Fund trace findings · {hits.length}
      </div>
      {hits.map((h, i) => (
        <div key={`${h.hop}-${h.address}`} className={`finding${open === i ? ' open' : ''}`}>
          <button type="button" className="finding-head" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            <span className={`badge ${h.reason === 'flagged' ? 'badge-high' : 'badge-severe'}`}>{HIT_LABEL[h.reason]}</span>
            <span className="mono finding-addr">
              {h.address.slice(0, 8)}…{h.address.slice(-6)}
            </span>
            <span className="faint finding-hop">{h.hop === 1 ? 'Direct source' : 'Step 2'}</span>
            <span className="chev" aria-hidden />
          </button>
          {open === i ? (
            <div className="reason-more">
              <p>
                {h.hop === 1
                  ? 'The sender received funds directly from this address.'
                  : 'This address sent funds to one of the sender’s sources, which then sent to the sender.'}
                {h.amount && Number(h.amount) > 0 ? ` Recent volume: ${formatAmount(Number(h.amount).toFixed(2), 2)} ${h.token}.` : ''}
              </p>
              <AddressActions address={h.address} via={h.via ?? undefined} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AddressResult({ r, title }: { r: AddressReport; title: string }) {
  const s = r.signals;
  const ageDays = s.createdAt ? Math.floor((Date.now() - s.createdAt) / 86_400_000) : null;
  return (
    <div className="panel result-in" data-level={r.risk.level}>
      <div className="panel-pad hero-split">
        <div style={{ minWidth: 0 }}>
          <span className="label">{title}</span>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <a className="mono break" style={{ fontSize: 14, flex: 1 }} href={`${TRONSCAN}/address/${r.address}`} target="_blank" rel="noreferrer">
              {r.address}
            </a>
            <CopyButton value={r.address} />
          </div>
          <div className="row row-wrap" style={{ marginTop: 14 }}>
            <KytStatus passed={r.risk.passed} />
            <RiskBadge level={r.risk.level} score={r.risk.score} />
          </div>
          <div className="row row-wrap faint" style={{ marginTop: 12, fontSize: 12.5, gap: 16 }}>
            <span>Age: {ageDays !== null ? `${ageDays} days` : 'unknown'}</span>
            <span>Token transfers: {s.trc20Count === null ? 'unknown' : s.trc20Count >= 50 ? '50+' : s.trc20Count}</span>
            <span>Tether: {s.tetherBlacklisted === null ? 'unknown' : s.tetherBlacklisted ? 'frozen' : 'clear'}</span>
            {s.trace ? (
              <span>
                Fund trace: {s.trace.hits.length ? `${s.trace.hits.length} tainted source${s.trace.hits.length === 1 ? '' : 's'}` : 'clean'} ·{' '}
                {s.trace.scanned} checked
              </span>
            ) : null}
          </div>
        </div>
        <AnimatedRing score={r.risk.score} level={r.risk.level} />
      </div>
      <div style={{ borderTop: '1px solid var(--hair)', padding: '6px 20px 10px' }}>
        <div className="row spread" style={{ padding: '8px 0 2px' }}>
          <span className="label">Why this score · tap for details</span>
          <CopyText value={reportText(r)} label="Copy report" />
        </div>
        <ReasonList reasons={r.risk.reasons} />
        <TraceFindings r={r} />
      </div>
    </div>
  );
}

function ResultView({ result }: { result: CheckResult }) {
  if (result.kind === 'error') return <div className="notice err result-in">{result.message}</div>;
  if (result.kind === 'address') return <AddressResult r={result} title="Address" />;
  return (
    <div className="stack result-in">
      <div className="row spread row-wrap">
        <span className="label">Transaction {shortHash(result.hash)}</span>
        <a className="btn btn-ghost btn-sm" href={`${TRONSCAN}/transaction/${result.hash}`} target="_blank" rel="noreferrer">
          <IconExternal /> Explorer
        </a>
      </div>
      {result.transfers.map((t, i) => (
        <div key={i} className="stack" style={{ gap: 10 }}>
          <div className="panel panel-pad">
            <div className="tx-title">
              {t.toOwnWallet ? 'You received' : 'Transfer of'} <span className="amt">{t.known ? formatAmount(t.amount) : t.amount}</span> {t.token}
              {!t.known ? (
                <span className="badge badge-severe" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                  Unknown token
                </span>
              ) : null}
            </div>
            <div className="tx-fields">
              <div className="tx-field">
                <div className="label">From</div>
                <div className="v">{t.from}</div>
              </div>
              <div className="tx-field">
                <div className="label">To</div>
                <div className="v">{t.to}</div>
              </div>
              <div className="tx-field">
                <div className="label">Time</div>
                <div className="v">{new Date(t.timestamp).toLocaleString('en-US')}</div>
              </div>
            </div>
          </div>
          <AddressResult r={t.sender} title="Sender screening" />
        </div>
      ))}
    </div>
  );
}

export function CheckForm({ deepAvailable }: { deepAvailable: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const paramQ = params.get('q');
  const [query, setQuery] = useState('');
  const [deep, setDeep] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runKind, setRunKind] = useState<Kind>('empty');
  const [runQuery, setRunQuery] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const queue = useRef<Array<() => void>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const started = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const lastParam = useRef<string | null>(null);

  const kind = detect(query);

  const pump = useCallback(() => {
    if (timer.current) return;
    const next = queue.current.shift();
    if (!next) return;
    next();
    timer.current = setTimeout(() => {
      timer.current = null;
      pump();
    }, STEP_GAP_MS);
  }, []);

  const enqueue = useCallback(
    (fn: () => void) => {
      queue.current.push(fn);
      pump();
    },
    [pump]
  );

  const applyStep = useCallback((step: CheckStep) => {
    setRows((prev) => {
      const key = (r: { id: string; group?: string }) => `${r.group ?? ''}|${r.id}`;
      const idx = prev.findIndex((r) => key(r) === key(step));
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], ...step, pending: false, skipped: false };
        return copy;
      }
      return [...prev, { ...step, seq: ++seq.current }];
    });
  }, []);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setElapsed(Date.now() - started.current), 100);
    return () => clearInterval(id);
  }, [phase]);

  const run = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      const k = detect(q);
      if (k === 'empty') return;

      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      queue.current = [];
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      seq.current = 0;

      setRunKind(k);
      setRunQuery(q);
      setResult(null);
      setError(null);
      setElapsed(0);
      started.current = Date.now();
      setRows(
        k === 'address'
          ? [
              ...ADDRESS_PLAN.map((p) => ({ ...p, state: 'run' as StepState, pending: true, seq: ++seq.current })),
              ...(deep && deepAvailable ? [{ id: 'deep', label: 'Deep screening', state: 'run' as StepState, pending: true, seq: ++seq.current }] : [])
            ]
          : []
      );
      setPhase('running');

      const finish = (fn: () => void) =>
        enqueue(() => {
          setRows((prev) => prev.map((r) => (r.pending ? { ...r, pending: false, skipped: true, detail: 'Not needed' } : r)));
          setElapsed(Date.now() - started.current);
          fn();
        });

      try {
        const res = await fetch('/api/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: q, deep: deep && deepAvailable }),
          signal: controller.signal
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || `Check failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let gotResult = false;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as { t: string } & Record<string, unknown>;
            if (ev.t === 'step') {
              const { t: _t, ...step } = ev;
              enqueue(() => applyStep(step as unknown as CheckStep));
            } else if (ev.t === 'result') {
              gotResult = true;
              const r = ev.result as CheckResult;
              finish(() => {
                setResult(r);
                setPhase(r.kind === 'error' ? 'error' : 'done');
                router.refresh();
              });
            } else if (ev.t === 'error') {
              gotResult = true;
              const m = String(ev.message || 'Check failed');
              finish(() => {
                setError(m);
                setPhase('error');
              });
            }
          }
        }
        if (!gotResult) throw new Error('The check ended unexpectedly. Try again.');
      } catch (e) {
        if (controller.signal.aborted) return;
        const m = e instanceof Error ? e.message : 'Check failed';
        finish(() => {
          setError(m);
          setPhase('error');
        });
      }
    },
    [applyStep, deep, deepAvailable, enqueue, router]
  );

  useEffect(() => {
    const q = (paramQ ?? '').trim().slice(0, 80);
    if (!q) {
      lastParam.current = null;
      return;
    }
    if (lastParam.current === q) return;
    lastParam.current = q;
    window.history.replaceState(null, '', '/check');
    setQuery(q);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    run(q);
  }, [paramQ, run]);

  useEffect(
    () => () => {
      abort.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach((r) => {
      const g = r.group ?? '';
      map.set(g, [...(map.get(g) || []), r]);
    });
    return [...map.entries()];
  }, [rows]);

  const total = rows.length;
  const completed = rows.filter((r) => !r.pending && (r.state !== 'run' || r.skipped)).length;
  const progress = phase === 'running' ? (total ? Math.max(0.06, completed / total) : 0.08) : 1;
  const current = rows.find((r) => !r.pending && r.state === 'run');
  const running = phase === 'running';
  const issues = rows.filter((r) => !r.pending && (r.state === 'bad' || r.state === 'warn')).length;

  return (
    <>
      <section className={`panel check-box${running ? ' is-scanning' : ''}`}>
        <div className="panel-pad">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(query);
            }}
          >
            <label className="field">
              <span className="row spread">
                <span className="label">Address or transaction</span>
                <span className={`detect detect-${kind}`} aria-live="polite">
                  {kind === 'address' ? 'TRON address' : kind === 'transaction' ? 'Transaction hash' : kind === 'invalid' ? 'Not recognized' : ''}
                </span>
              </span>
              <input
                className="input mono"
                name="query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="T… address or transaction hash"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                inputMode="text"
                required
              />
            </label>
            <div className="row row-wrap spread">
              {deepAvailable ? (
                <label className="check">
                  <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
                  <span className="muted" style={{ fontSize: 13 }}>Deep screening (paid check)</span>
                </label>
              ) : (
                <span className="faint" style={{ fontSize: 12.5 }}>Sanctions · Tether blacklist · your flags · age · activity · 2-step fund trace</span>
              )}
              <button type="submit" className="btn btn-primary" disabled={running || kind === 'empty' || kind === 'invalid'}>
                {running ? (
                  <>
                    <span className="btn-dot" /> Checking
                  </>
                ) : (
                  <>
                    <IconSearch /> Check
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
        <div className="scan-bar" aria-hidden>
          <span style={{ transform: `scaleX(${phase === 'idle' ? 0 : progress})` }} />
        </div>
      </section>

      {phase !== 'idle' && (result || error) ? (
        result ? <ResultView result={result} /> : <div className="notice err result-in">{error}</div>
      ) : null}

      {phase !== 'idle' ? (
        <section className="panel scan-panel">
          <div className="panel-head">
            <div className="row" style={{ gap: 12, minWidth: 0 }}>
              <div className={`radar${running ? ' on' : ''}`} aria-hidden>
                <span />
                <span />
                <i />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2>{running ? 'Verifying' : 'Verification log'}</h2>
                <div className="mono faint scan-target">
                  {runKind === 'transaction' ? `tx ${shortHash(runQuery, 6, 6)}` : runQuery.length > 20 ? `${runQuery.slice(0, 10)}…${runQuery.slice(-8)}` : runQuery}
                </div>
              </div>
            </div>
            <div className="scan-meta">
              <span className="mono tnum">{(elapsed / 1000).toFixed(1)}s</span>
              <span className="label">
                {running ? `${completed}/${total || '…'}` : `${rows.filter((r) => !r.skipped).length} checks${issues ? ` · ${issues} warning${issues === 1 ? '' : 's'}` : ''}`}
              </span>
            </div>
          </div>
          {running && current ? (
            <div className="scan-now" key={current.id + (current.group ?? '')}>
              <span className="label">Now</span>
              <span className="scan-now-text">
                {current.group ? `${current.group} · ` : ''}
                {current.label}
                {current.detail ? <em> — {current.detail}</em> : null}
              </span>
            </div>
          ) : null}
          <div className="panel-pad steps">
            {rows.length === 0 && running ? (
              <div className="step is-run">
                <span className="sx sx-run" />
                <div className="step-body">
                  <div className="step-label">Preparing check</div>
                </div>
              </div>
            ) : null}
            {groups.map(([g, list]) => (
              <div key={g || 'main'} className="step-group">
                {g ? <div className="label step-group-title">{g}</div> : null}
                {list.map((r) => (
                  <StepRow key={`${r.group ?? ''}|${r.id}`} row={r} />
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
