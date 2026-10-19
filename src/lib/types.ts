export type RiskLevel = 'low' | 'medium' | 'high' | 'severe';

export type Reason = {
  code: string;
  label: string;
  weight: number;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  address?: string;
  via?: string;
};

export type AddressSignals = {
  address: string;
  valid: boolean;
  tetherBlacklisted: boolean | null;
  sanctioned: boolean;
  flagged: { label: string | null; severity: number; source: string } | null;
  createdAt: number | null;
  activated: boolean;
  trc20Count: number | null;
  isOwnWallet: boolean;
  poisoningOf: string | null;
  trace: TraceResult | null;
};

export type TraceHit = {
  address: string;
  hop: 1 | 2;
  via: string | null;
  reason: 'tether_blacklist' | 'sanctions' | 'flagged';
  label: string | null;
  amount: string;
  token: string;
};

export type TraceResult = {
  scanned: number;
  sources: number;
  hits: TraceHit[];
  tracedAt: string;
};

export type DeepResult = {
  provider: string;
  score: number;
  signals: { label: string; share: number }[];
  raw?: unknown;
};

export type RiskResult = {
  score: number;
  level: RiskLevel;
  passed: boolean;
  reasons: Reason[];
};

export type Wallet = {
  id: string;
  label: string;
  address: string;
  network: string;
  active: boolean;
  last_seen_ts: number;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type Transfer = {
  id: string;
  wallet_id: string;
  network: string;
  event_key: string;
  tx_hash: string;
  token: string;
  token_contract: string;
  amount: string;
  from_address: string;
  to_address: string;
  block_ts: string;
  risk_score: number;
  risk_level: RiskLevel;
  kyt_passed: boolean;
  reasons: Reason[];
  signals: Partial<AddressSignals> & { deep?: DeepResult | null };
  deep_checked: boolean;
  alerted: boolean;
  created_at: string;
  wallets?: Pick<Wallet, 'label' | 'address' | 'network'> | null;
};

export type Settings = {
  id: number;
  alert_mode: 'all' | 'risk' | 'off';
  alert_min_level: RiskLevel;
  deep_check_enabled: boolean;
  deep_check_threshold: number;
  min_amount: number;
  cache_hours: number;
  sanctions_synced_at: string | null;
  access_code_hash?: string | null;
  updated_at: string;
};

export type FlaggedAddress = {
  address: string;
  network: string;
  source: 'manual' | 'sanctions';
  label: string | null;
  severity: number;
  created_at: string;
};

export type StepState = 'run' | 'ok' | 'warn' | 'bad' | 'info';

export type CheckStep = {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  group?: string;
};

export type StepEmitter = (step: CheckStep) => void;
