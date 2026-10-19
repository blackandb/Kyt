'use client';

import { useActionState } from 'react';
import { checkAction } from '@/app/actions';
import { SubmitButton, CopyButton } from '@/components/ui';
import { KytStatus, ReasonList, RiskBadge, ScoreRing } from '@/components/risk';
import { IconExternal, IconSearch } from '@/components/icons';
import { formatAmount, shortHash } from '@/lib/format';
import type { AddressReport } from '@/lib/check';

const TRONSCAN = 'https://tronscan.org/#';

function AddressResult({ r, title }: { r: AddressReport; title: string }) {
  const s = r.signals;
  const ageDays = s.createdAt ? Math.floor((Date.now() - s.createdAt) / 86_400_000) : null;
  return (
    <div className="panel fade-up">
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
          </div>
        </div>
        <ScoreRing score={r.risk.score} level={r.risk.level} size={116} />
      </div>
      <div style={{ borderTop: '1px solid var(--hair)', padding: '6px 20px 10px' }}>
        <ReasonList reasons={r.risk.reasons} />
      </div>
    </div>
  );
}

export function CheckForm({ deepAvailable }: { deepAvailable: boolean }) {
  const [state, action] = useActionState(checkAction, null);
  const result = state?.result;

  return (
    <>
      <section className="panel">
        <div className="panel-pad">
          <form action={action} className="stack">
            <label className="field">
              <span className="label">Address or transaction</span>
              <input
                className="input mono"
                name="query"
                defaultValue={state?.query}
                placeholder="T… address or transaction hash"
                spellCheck={false}
                autoComplete="off"
                required
              />
            </label>
            <div className="row row-wrap spread">
              {deepAvailable ? (
                <label className="check">
                  <input type="checkbox" name="deep" />
                  <span className="muted" style={{ fontSize: 13 }}>Deep screening (paid check)</span>
                </label>
              ) : (
                <span className="faint" style={{ fontSize: 12.5 }}>Free checks: Tether blacklist, sanctions, your flags, age, activity.</span>
              )}
              <SubmitButton pendingText="Checking">
                <IconSearch /> Check
              </SubmitButton>
            </div>
          </form>
        </div>
      </section>

      {result?.kind === 'error' ? <div className="notice err">{result.message}</div> : null}

      {result?.kind === 'address' ? <AddressResult r={result} title="Address" /> : null}

      {result?.kind === 'transaction' ? (
        <div className="stack">
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
                  {t.toOwnWallet ? 'You received' : 'Transfer of'} <span className="amt">{t.known ? formatAmount(t.amount) : t.amount}</span>{' '}
                  {t.token}
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
      ) : null}
    </>
  );
}
