import Link from 'next/link';
import { db } from '@/lib/supabase/admin';
import { requireOwner } from '@/lib/auth';
import { env } from '@/lib/env';
import { formatAmount, timeAgo } from '@/lib/format';
import { TransferCard } from '@/components/transfer-card';
import { SyncButton } from '@/components/sync-button';
import { ObjectTile } from '@/components/object-tile';
import { IconDownload } from '@/components/icons';
import type { RiskLevel, Transfer } from '@/lib/types';

const PAGE = 25;
const LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'severe'];

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ level?: string; page?: string }> }) {
  const sp = await searchParams;
  const level = LEVELS.includes(sp.level as RiskLevel) ? (sp.level as RiskLevel) : null;
  const page = Math.max(1, Number(sp.page || 1));
  const owner = await requireOwner();
  const client = db();
  const tz = env.timezone();

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  let list = client
    .from('transfers')
    .select('*, wallets(label, address, network)', { count: 'exact' })
    .eq('owner_id', owner)
    .order('block_ts', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (level) list = list.eq('risk_level', level);

  const [listRes, day, week, flagged, wallets, ...levelCounts] = await Promise.all([
    list,
    client.from('transfers').select('amount, token').eq('owner_id', owner).gte('block_ts', dayAgo),
    client.from('transfers').select('id', { count: 'exact', head: true }).eq('owner_id', owner).gte('block_ts', weekAgo),
    client.from('transfers').select('id', { count: 'exact', head: true }).eq('owner_id', owner).gte('block_ts', monthAgo).in('risk_level', ['high', 'severe']),
    client.from('wallets').select('active, last_synced_at, last_error').eq('owner_id', owner),
    ...LEVELS.map((l) => client.from('transfers').select('id', { count: 'exact', head: true }).eq('owner_id', owner).eq('risk_level', l))
  ]);

  const transfers = (listRes.data || []) as Transfer[];
  const total = listRes.count || 0;
  const received24 = (day.data || []).reduce((sum, r) => sum + Number(r.amount), 0);
  const walletRows = wallets.data || [];
  const activeWallets = walletRows.filter((w) => w.active).length;
  const lastSync = walletRows
    .map((w) => w.last_synced_at as string | null)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;
  const walletErrors = walletRows.filter((w) => w.last_error).length;
  const counts = Object.fromEntries(LEVELS.map((l, i) => [l, levelCounts[i].count || 0])) as Record<RiskLevel, number>;
  const allCount = LEVELS.reduce((s, l) => s + counts[l], 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const href = (l: RiskLevel | null, p = 1) => {
    const q = new URLSearchParams();
    if (l) q.set('level', l);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `/transfers?${s}` : '/transfers';
  };

  return (
    <>
      <header className="topbar">
        <h1>Transfers</h1>
        <div className="row">
          <SyncButton />
          <a className="btn btn-ghost btn-sm" href="/api/export">
            <IconDownload /> CSV
          </a>
        </div>
      </header>

      <div className="content">
        <section className="grid grid-4">
          <div className="panel metric fade-up">
            <div className="label">Received · 24h</div>
            <div className="metric-value">{formatAmount(received24.toFixed(2), 2)}</div>
            <div className="metric-foot">USDT + USDC</div>
          </div>
          <div className="panel metric fade-up d1">
            <div className="label">Transfers · 7d</div>
            <div className="metric-value">{week.count || 0}</div>
            <div className="metric-foot">Incoming, screened</div>
          </div>
          <div className="panel metric fade-up d2">
            <div className="label">High risk · 30d</div>
            <div className="metric-value" style={{ color: (flagged.count || 0) > 0 ? 'var(--red-fg)' : undefined }}>
              {flagged.count || 0}
            </div>
            <div className="metric-foot">
              <span className="dot" style={{ background: (flagged.count || 0) > 0 ? 'var(--red-fg)' : 'var(--green-fg)' }} />
              {(flagged.count || 0) > 0 ? 'Review required' : 'Nothing to review'}
            </div>
          </div>
          <div className="panel metric fade-up d3">
            <div className="label">Wallets</div>
            <div className="metric-value">{activeWallets}</div>
            <div className="metric-foot">
              {walletErrors > 0 ? (
                <>
                  <span className="dot" style={{ background: 'var(--amber-fg)' }} />
                  {walletErrors} with sync errors
                </>
              ) : (
                <>
                  <span className="live-dot" />
                  Synced {timeAgo(lastSync ?? null)}
                </>
              )}
            </div>
          </div>
        </section>

        <section className="section-gap">
          <div className="row spread row-wrap" style={{ marginBottom: 14 }}>
            <div className="tabs">
              <Link className={`tab${!level ? ' active' : ''}`} href={href(null)}>
                All <span className="count">{allCount}</span>
              </Link>
              {LEVELS.map((l) => (
                <Link key={l} className={`tab${level === l ? ' active' : ''}`} href={href(l)}>
                  {l[0].toUpperCase() + l.slice(1)} <span className="count">{counts[l]}</span>
                </Link>
              ))}
            </div>
          </div>

          {transfers.length === 0 ? (
            <div className="panel empty">
              <ObjectTile size="md" />
              <h3>{activeWallets === 0 ? 'Add your first wallet' : 'No transfers yet'}</h3>
              <p>
                {activeWallets === 0
                  ? 'Add a TRON address to start monitoring incoming USDT and USDC.'
                  : 'Incoming transfers appear here as soon as they are confirmed and screened.'}
              </p>
              {activeWallets === 0 ? (
                <Link className="btn btn-primary" href="/wallets" style={{ marginTop: 8 }}>
                  Add wallet
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="stack">
              {transfers.map((t) => (
                <TransferCard key={t.id} t={t} timezone={tz} />
              ))}
            </div>
          )}

          {pages > 1 ? (
            <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              {page > 1 ? (
                <Link className="btn btn-ghost btn-sm" href={href(level, page - 1)}>
                  Previous
                </Link>
              ) : null}
              <span className="faint mono" style={{ fontSize: 12 }}>
                {page} / {pages}
              </span>
              {page < pages ? (
                <Link className="btn btn-ghost btn-sm" href={href(level, page + 1)}>
                  Next
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
