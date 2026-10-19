import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { explorer } from '@/lib/tron';
import { formatAmount, formatTime, timeAgo } from '@/lib/format';
import { deepCheckConfigured } from '@/lib/amlbot';
import { recheckTransfer, quickFlag } from '@/app/actions';
import { KytStatus, ReasonList, RiskBadge, ScoreRing } from '@/components/risk';
import { CopyButton, SubmitButton } from '@/components/ui';
import { IconArrowLeft, IconExternal, IconFlag, IconRefresh, IconShield } from '@/components/icons';
import type { Transfer } from '@/lib/types';

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await db().from('transfers').select('*, wallets(label, address, network)').eq('id', id).maybeSingle();
  if (!data) notFound();
  const t = data as Transfer;
  const tz = env.timezone();

  const { data: flag } = await db().from('flagged_addresses').select('source').eq('address', t.from_address).maybeSingle();
  const { count: senderCount } = await db()
    .from('transfers')
    .select('id', { count: 'exact', head: true })
    .eq('from_address', t.from_address);

  const s = t.signals || {};
  const ageDays = s.createdAt ? Math.floor((new Date(t.block_ts).getTime() - Number(s.createdAt)) / 86_400_000) : null;

  return (
    <>
      <header className="topbar">
        <div className="row">
          <Link className="btn btn-ghost btn-sm btn-icon" href="/transfers" aria-label="Back">
            <IconArrowLeft />
          </Link>
          <h1>Transfer report</h1>
        </div>
        <a className="btn btn-ghost btn-sm" href={explorer.tx(t.tx_hash)} target="_blank" rel="noreferrer">
          <IconExternal /> Explorer
        </a>
      </header>

      <div className="content stack">
        <section className="panel panel-pad fade-up hero-split">
          <div style={{ minWidth: 0 }}>
            <span className="label">Incoming · {t.network}</span>
            <h2 className="headline" style={{ fontSize: 'clamp(26px, 5vw, 40px)', margin: '12px 0 14px' }}>
              <span className="g1">You received</span>
              <br />
              <span className="tnum">{formatAmount(t.amount)}</span> <span className="faint">{t.token}</span>
            </h2>
            <div className="row row-wrap">
              <KytStatus passed={t.kyt_passed} />
              <RiskBadge level={t.risk_level} score={t.risk_score} />
              {t.deep_checked ? (
                <span className="badge badge-neutral">
                  <IconShield width={12} height={12} /> Deep screened
                </span>
              ) : null}
            </div>
          </div>
          <ScoreRing score={t.risk_score} level={t.risk_level} />
        </section>

        <section className="grid grid-2">
          <div className="panel">
            <div className="panel-head">
              <h2>Details</h2>
            </div>
            <div className="panel-pad stack" style={{ gap: 16 }}>
              <div>
                <div className="label">Sender</div>
                <div className="row" style={{ marginTop: 6, alignItems: 'flex-start' }}>
                  <a className="mono break" style={{ fontSize: 13, flex: 1 }} href={explorer.address(t.from_address)} target="_blank" rel="noreferrer">
                    {t.from_address}
                  </a>
                  <CopyButton value={t.from_address} />
                </div>
                <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                  {senderCount ?? 1} transfer{senderCount === 1 ? '' : 's'} from this sender
                  {ageDays !== null ? ` · address age ${ageDays} days` : ''}
                </div>
              </div>
              <div>
                <div className="label">Wallet</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  {t.wallets?.label ?? 'Wallet'} · {t.network}
                </div>
                <div className="row" style={{ marginTop: 2, alignItems: 'flex-start' }}>
                  <span className="mono break" style={{ fontSize: 13, flex: 1 }}>{t.to_address}</span>
                  <CopyButton value={t.to_address} />
                </div>
              </div>
              <div>
                <div className="label">Tx</div>
                <div className="row" style={{ marginTop: 6, alignItems: 'flex-start' }}>
                  <a className="mono break" style={{ fontSize: 13, flex: 1 }} href={explorer.tx(t.tx_hash)} target="_blank" rel="noreferrer">
                    {t.tx_hash}
                  </a>
                  <CopyButton value={t.tx_hash} />
                </div>
              </div>
              <div className="grid grid-2" style={{ gap: 16 }}>
                <div>
                  <div className="label">Time</div>
                  <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>{formatTime(t.block_ts, tz)}</div>
                </div>
                <div>
                  <div className="label">Screened</div>
                  <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>{timeAgo(t.created_at)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Why this score</h2>
            </div>
            <div className="panel-pad" style={{ paddingTop: 6 }}>
              <ReasonList reasons={t.reasons || []} />
            </div>
          </div>
        </section>

        {s.trace ? (
          <section className="panel">
            <div className="panel-head">
              <h2>Fund trace</h2>
              <span className="label">
                2 steps · {s.trace.scanned} addresses checked
              </span>
            </div>
            <div className="panel-pad">
              {s.trace.hits.length === 0 ? (
                <div className="row" style={{ gap: 10 }}>
                  <span className="badge badge-low">
                    <span className="dot" /> Clean
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    None of the sender&apos;s {s.trace.sources} main sources, or their sources, are frozen, sanctioned or flagged.
                  </span>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Source</th>
                        <th>Finding</th>
                        <th>Via</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.trace.hits.map((h) => (
                        <tr key={`${h.hop}-${h.address}`}>
                          <td className="mono">{h.hop}</td>
                          <td>
                            <a className="mono" style={{ fontSize: 12.5 }} href={explorer.address(h.address)} target="_blank" rel="noreferrer">
                              {h.address.slice(0, 8)}…{h.address.slice(-6)}
                            </a>
                          </td>
                          <td>
                            <span className={`badge ${h.reason === 'flagged' ? 'badge-high' : 'badge-severe'}`}>
                              {h.reason === 'tether_blacklist' ? 'Frozen by Tether' : h.reason === 'sanctions' ? 'Sanctioned' : 'Flagged by you'}
                            </span>
                          </td>
                          <td className="mono faint" style={{ fontSize: 12.5 }}>
                            {h.via ? `${h.via.slice(0, 8)}…${h.via.slice(-6)}` : 'direct'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : null}

        <section className="panel panel-pad row row-wrap spread">
          <div>
            <div style={{ fontWeight: 500 }}>Actions</div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              Re-screen the sender with fresh data, or flag it so future transfers are marked.
            </div>
          </div>
          <div className="row row-wrap">
            <form action={recheckTransfer}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="deep" value="false" />
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Checking">
                <IconRefresh /> Re-check
              </SubmitButton>
            </form>
            {deepCheckConfigured() ? (
              <form action={recheckTransfer}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="deep" value="true" />
                <SubmitButton className="btn btn-ghost btn-sm" pendingText="Screening">
                  <IconShield /> Deep check
                </SubmitButton>
              </form>
            ) : null}
            {flag ? (
              <span className="badge badge-severe">
                <IconFlag width={12} height={12} /> {flag.source === 'sanctions' ? 'Sanctioned' : 'Flagged'}
              </span>
            ) : (
              <form action={quickFlag}>
                <input type="hidden" name="address" value={t.from_address} />
                <input type="hidden" name="transferId" value={t.id} />
                <SubmitButton className="btn btn-danger btn-sm" pendingText="Flagging">
                  <IconFlag /> Flag sender
                </SubmitButton>
              </form>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
