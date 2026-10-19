import { LEVEL_LABEL } from '@/lib/format';
import type { Reason, RiskLevel } from '@/lib/types';

const COLOR: Record<RiskLevel, string> = {
  low: 'var(--green-fg)',
  medium: 'var(--amber-fg)',
  high: 'var(--orange-fg)',
  severe: 'var(--red-fg)'
};

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <span className={`badge badge-${level}`}>
      <span className="dot" />
      {LEVEL_LABEL[level]}
      {score !== undefined ? <span className="mono tnum" style={{ opacity: 0.85 }}>· {score}</span> : null}
    </span>
  );
}

export function KytStatus({ passed }: { passed: boolean }) {
  return <span className={`kyt ${passed ? 'pass' : 'fail'}`}>KYT {passed ? 'Passed' : 'Failed'}</span>;
}

export function ScoreRing({ score, level, size = 132 }: { score: number; level: RiskLevel; size?: number }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, score)) / 100);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLOR[level]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="num">
        <b className="tnum">{score}</b>
        <span className="label">Score</span>
      </div>
    </div>
  );
}

const ICON: Record<Reason['tone'], string> = { ok: '✓', warn: '!', bad: '✕', info: 'i' };

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  const order: Record<Reason['tone'], number> = { bad: 0, warn: 1, info: 2, ok: 3 };
  const sorted = [...reasons].sort((a, b) => order[a.tone] - order[b.tone]);
  return (
    <div className="reasons">
      {sorted.map((r) => (
        <div className="reason" key={r.code + r.label}>
          <span className={`ic ${r.tone}`}>{ICON[r.tone]}</span>
          <span>{r.label}</span>
          {r.weight > 0 ? <span className="w">+{r.weight}</span> : null}
        </div>
      ))}
    </div>
  );
}
