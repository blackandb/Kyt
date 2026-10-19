import { LEVEL_LABEL } from '@/lib/format';
import type { RiskLevel } from '@/lib/types';

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
