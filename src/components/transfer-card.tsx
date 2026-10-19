import Link from 'next/link';
import { formatAmount, formatTime, shortHash } from '@/lib/format';
import { KytStatus, RiskBadge } from '@/components/risk';
import type { Transfer } from '@/lib/types';

export function TransferCard({ t, timezone }: { t: Transfer; timezone: string }) {
  return (
    <Link href={`/transfers/${t.id}`} className="tx-card" data-level={t.risk_level}>
      <div style={{ minWidth: 0 }}>
        <div className="tx-title">
          You received <span className="amt">{formatAmount(t.amount)}</span> {t.token}
        </div>
        <div className="tx-fields">
          <div className="tx-field">
            <div className="label">Sender</div>
            <div className="v">{t.from_address}</div>
          </div>
          <div className="tx-field">
            <div className="label">Wallet</div>
            <div className="v">
              <small>
                {t.wallets?.label ?? 'Wallet'} · {t.network}
              </small>
              {t.to_address}
            </div>
          </div>
          <div className="tx-field">
            <div className="label">Tx</div>
            <div className="v">{shortHash(t.tx_hash)}</div>
          </div>
        </div>
      </div>
      <div className="tx-side">
        <span className="tx-time">{formatTime(t.block_ts, timezone)}</span>
        <div className="kyt-line">
          <KytStatus passed={t.kyt_passed} />
          <RiskBadge level={t.risk_level} score={t.risk_score} />
        </div>
      </div>
    </Link>
  );
}
