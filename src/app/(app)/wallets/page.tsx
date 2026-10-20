import { db } from '@/lib/supabase/admin';
import { requireOwner } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { deleteWallet, renameWallet, toggleWallet } from '@/app/actions';
import { CopyButton, SubmitButton } from '@/components/ui';
import { SyncButton } from '@/components/sync-button';
import { AddWalletForm } from './add-wallet-form';
import type { Wallet } from '@/lib/types';

export default async function WalletsPage() {
  const owner = await requireOwner();
  const { data } = await db().from('wallets').select('*').eq('owner_id', owner).order('created_at');
  const wallets = (data || []) as Wallet[];
  const { data: counts } = await db().from('transfers').select('wallet_id').eq('owner_id', owner);
  const perWallet = new Map<string, number>();
  (counts || []).forEach((c) => perWallet.set(c.wallet_id, (perWallet.get(c.wallet_id) || 0) + 1));

  return (
    <>
      <header className="topbar">
        <h1>Wallets</h1>
        <SyncButton />
      </header>
      <div className="content stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Add wallet</h2>
            <span className="label">TRON · USDT / USDC</span>
          </div>
          <div className="panel-pad">
            <AddWalletForm nextLabel={`Wallet ${wallets.length + 1}`} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Monitored</h2>
            <span className="label">{wallets.filter((w) => w.active).length} active</span>
          </div>
          {wallets.length === 0 ? (
            <div className="panel-pad faint">No wallets yet.</div>
          ) : (
            <div className="panel-pad stack" style={{ gap: 0, paddingTop: 4, paddingBottom: 4 }}>
              {wallets.map((w) => (
                <div key={w.id} className="wallet-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <form action={renameWallet} className="row">
                      <input type="hidden" name="id" value={w.id} />
                      <input className="input inline-edit" name="label" defaultValue={w.label} aria-label="Wallet label" />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                        Save
                      </SubmitButton>
                    </form>
                    <div className="row" style={{ marginTop: 6 }}>
                      <span className="mono break faint" style={{ fontSize: 12.5 }}>{w.address}</span>
                      <CopyButton value={w.address} />
                    </div>
                    <div className="row row-wrap" style={{ marginTop: 6, gap: 8 }}>
                      <span className={`badge ${w.active ? 'badge-low' : 'badge-neutral'}`}>
                        <span className="dot" /> {w.active ? 'Monitoring' : 'Paused'}
                      </span>
                      <span className="badge badge-neutral">{w.network}</span>
                      <span className="faint" style={{ fontSize: 12 }}>
                        {perWallet.get(w.id) || 0} transfers · synced {timeAgo(w.last_synced_at)}
                      </span>
                    </div>
                    {w.last_error ? (
                      <div className="notice err" style={{ marginTop: 8, fontSize: 12 }}>
                        {w.last_error}
                      </div>
                    ) : null}
                  </div>
                  <div className="row">
                    <form action={toggleWallet}>
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="active" value={String(w.active)} />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                        {w.active ? 'Pause' : 'Resume'}
                      </SubmitButton>
                    </form>
                    <form action={deleteWallet}>
                      <input type="hidden" name="id" value={w.id} />
                      <SubmitButton className="btn btn-danger btn-sm" pendingText="…">
                        Remove
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
