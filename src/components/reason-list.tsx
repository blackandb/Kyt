'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconCheck, IconCopy, IconExternal, IconSearch } from '@/components/icons';
import type { Reason } from '@/lib/types';

const ICON: Record<Reason['tone'], string> = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
const ORDER: Record<Reason['tone'], number> = { bad: 0, warn: 1, info: 2, ok: 3 };

const EXPLAIN: Record<string, string> = {
  tether_blacklist: 'Tether has frozen this address. USDT held here cannot move, and exchanges reject funds connected to it.',
  tether_clear: 'Checked directly on the USDT contract: this address itself is not frozen. Its sources are checked separately in the fund trace.',
  tether_unknown: 'The USDT contract did not answer in time. Run the check again to confirm.',
  sanctioned: 'This address is on the OFAC sanctions list. Receiving or forwarding these funds can freeze your accounts.',
  sanctions_clear: 'The address does not appear on the OFAC list of sanctioned TRON addresses.',
  flagged: 'You flagged this address yourself in Flags.',
  poisoning:
    'Address poisoning: scammers create an address that starts and ends like one you trust, hoping you copy the wrong one from your history. Compare every character before sending.',
  age_new: 'Addresses this new are often created to move funds once and be discarded.',
  age_young: 'A young address has little history to judge it by.',
  age_ok: 'The address has existed long enough to build a track record.',
  age_unknown: 'The account is not activated on TRON or its creation date is unavailable.',
  activity_none: 'Very few token transfers: there is almost no history to assess.',
  activity_low: 'Limited token history.',
  activity_ok: 'The address has an established history of token transfers.',
  large_from_new: 'A large amount coming from a recently created address is a common pattern in fraud.',
  trace_hop1:
    'Fund trace, step 1: the sender received money directly from this address, which is frozen or sanctioned. Exchanges may freeze funds that passed through it, even if the sender itself is clean.',
  trace_hop1_flag: 'Fund trace, step 1: the sender received money directly from an address you flagged.',
  trace_hop2: 'Fund trace, step 2: the money reached the sender through one intermediate address. The link is weaker than a direct one, but still relevant.',
  trace_hop2_flag: 'Fund trace, step 2: one of the sender’s sources received money from an address you flagged.',
  trace_clear: 'The sender’s main incoming sources, and their sources, were checked against the Tether blacklist, sanctions and your flags. Nothing was found.',
  deep: 'Result from the paid deep-screening provider, based on its private address labels.',
  own: 'This is one of your own monitored wallets.',
  invalid: 'The address does not pass the TRON format and checksum test.'
};

export function CopyText({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = value;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <IconCheck /> : <IconCopy />} {done ? 'Copied' : label}
    </button>
  );
}

export function AddressActions({ address, via }: { address: string; via?: string }) {
  return (
    <div className="addr-box" onClick={(e) => e.stopPropagation()}>
      <div className="addr-full mono">{address}</div>
      {via ? (
        <div className="addr-via">
          <span className="label">Via</span> <span className="mono">{via}</span>
        </div>
      ) : null}
      <div className="row row-wrap" style={{ gap: 6 }}>
        <CopyText value={address} label="Copy address" />
        <a className="btn btn-ghost btn-sm" href={`https://tronscan.org/#/address/${address}`} target="_blank" rel="noreferrer">
          <IconExternal /> Tronscan
        </a>
        <Link className="btn btn-ghost btn-sm" prefetch={false} href={`/check?q=${encodeURIComponent(address)}`}>
          <IconSearch /> Check it
        </Link>
      </div>
    </div>
  );
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...reasons].sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
  return (
    <div className="reasons">
      {sorted.map((r) => {
        const key = r.code + r.label;
        const isOpen = open === key;
        const explain = EXPLAIN[r.code];
        const expandable = !!explain || !!r.address;
        return (
          <div className={`reason-item${isOpen ? ' open' : ''}`} key={key}>
            <button
              type="button"
              className="reason"
              aria-expanded={isOpen}
              disabled={!expandable}
              onClick={() => setOpen(isOpen ? null : key)}
            >
              <span className={`ic ${r.tone}`}>{ICON[r.tone]}</span>
              <span className="reason-text">{r.label}</span>
              {r.weight > 0 ? <span className="w">+{r.weight}</span> : null}
              {expandable ? <span className="chev" aria-hidden /> : null}
            </button>
            {isOpen ? (
              <div className="reason-more">
                {explain ? <p>{explain}</p> : null}
                {r.address ? <AddressActions address={r.address} via={r.via} /> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
