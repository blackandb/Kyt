'use client';
import { useEffect, useRef, useState } from 'react';
import { auditVerdict, units, type FullAudit, type AuditPeer } from '@/lib/audit-model';

type ResponseData = { id: string; audit: FullAudit };
const explorer = (a: string) => 'https://tronscan.org/#/address/' + a;
const problem = (p: AuditPeer) => p.status === 'blocked' || p.sanctioned || p.flagged;
function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function FullAuditForm() {
  const [address, setAddress] = useState('');
  const [months, setMonths] = useState(0);
  const [job, setJob] = useState<ResponseData | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyHits, setOnlyHits] = useState(true);
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  async function post(body: unknown, signal?: AbortSignal): Promise<ResponseData> {
    const response = await fetch('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Scan unavailable (' + response.status + ')');
    return data as ResponseData;
  }
  useEffect(() => {
    let active = true;
    let id: string | null = null;
    try { id = new URLSearchParams(window.location.search).get('audit') || sessionStorage.getItem('kyt-full-audit'); } catch { /* storage disabled */ }
    if (id) post({ id, action: 'status' }).then(data => {
      if (active) { setJob(data); setAddress(data.audit.address); }
    }).catch(() => { /* A saved ID is only a convenience, never an authentication credential. */ });
    return () => { active = false; generation.current++; controller.current?.abort(); };
  }, []);
  async function run(resume: boolean) {
    if (running) return;
    const gen = ++generation.current;
    const ac = new AbortController(); controller.current = ac;
    setRunning(true); setError(''); setPage(0);
    try {
      let current = resume && job ? job : await post({ address, months }, ac.signal);
      if (gen !== generation.current) return;
      setJob(current);
      try { sessionStorage.setItem('kyt-full-audit', current.id); } catch { /* storage disabled */ }
      while (current.audit.phase !== 'done' && gen === generation.current) {
        current = await post({ id: current.id }, ac.signal);
        if (gen !== generation.current) return;
        setJob(current);
        if (current.audit.lastError) throw new Error(current.audit.lastError);
      }
    } catch (e) {
      if (gen === generation.current && !ac.signal.aborted)
        setError(e instanceof Error ? e.message : 'Scan interrupted. Resume to continue.');
    } finally { if (gen === generation.current) setRunning(false); }
  }
  function stop() { generation.current++; controller.current?.abort(); setRunning(false); }
  const a = job?.audit;
  const hits = a?.peers.filter(problem) || [];
  const checked = a?.peers.filter(p => p.status !== null).length || 0;
  const unknown = a?.peers.filter(p => p.status === 'unknown').length || 0;
  const verdict = a ? auditVerdict(a) : null;
  const rows = (a?.peers || []).filter(p => (!onlyHits || problem(p)) && p.address.toLowerCase().includes(search.toLowerCase()))
    .sort((x,y) => Number(problem(y)) - Number(problem(x)) || x.address.localeCompare(y.address));
  const csv = () => {
    if (!a) return;
    const content = [
      ['Address','USDT blacklist status','Sanctions in configured list','Manual flag','Transfers','Positive value transfers',
        'USDT sent to scanned address','USDT received from scanned address','TRX sent to scanned address','TRX received from scanned address','Status checked at'],
      ...a.peers.map(p => [p.address,p.status || 'not checked',String(p.sanctioned),String(p.flagged),String(p.transfers),
        String(p.positiveTransfers),units(p.incomingUsdt),units(p.outgoingUsdt),units(p.incomingTrx),units(p.outgoingTrx),p.checkedAt || ''])
    ].map(row => row.map(cell => '"' + cell.replace(/"/g, '""') + '"').join(',')).join('\r\n');
    download('KYT-' + a.address + '.csv', '\uFEFF' + content, 'text/csv;charset=utf-8');
  };
  return <section className="panel" aria-label="Full address audit">
    <div className="panel-head"><h2>Full address audit</h2><span className="badge">TRON · USDT</span></div>
    <div className="panel-pad stack">
      <p className="muted" style={{ margin: 0 }}>Checks every direct counterparty in incoming and outgoing token, TRX and TRC10 transfers.
        Progress is saved after each batch, so large histories can be resumed.</p>
      <form className="stack" onSubmit={e => { e.preventDefault(); void run(false); }}>
        <label className="field"><span className="label">TRON address</span>
          <input className="input mono" value={address} onChange={e => setAddress(e.target.value)} required
            placeholder="T…" spellCheck={false} autoComplete="off" disabled={running} maxLength={34} />
        </label>
        <div className="row row-wrap">
          <label className="field"><span className="label">History</span>
            <select className="input" value={months} onChange={e => setMonths(Number(e.target.value))} disabled={running}>
              <option value={0}>Entire available history</option><option value={6}>Last 6 months</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={running}>{running ? 'Scanning…' : 'Run full audit'}</button>
          {running ? <button className="btn btn-ghost" type="button" onClick={stop}>Pause</button> : null}
          {!running && a && a.phase !== 'done' ? <button className="btn" type="button" onClick={() => void run(true)}>Resume saved audit</button> : null}
        </div>
      </form>
      {error ? <div role="alert" className="notice err">{error} Your saved progress remains available.</div> : null}
      {a ? <>
        <div className="notice" aria-live="polite">
          <strong>{verdict === 'OK' ? 'OK within the checked scope' : verdict === 'BLOCKED' ? 'BLOCKED / FLAGGED — do not approve' :
            verdict === 'NOT_OK' ? 'NOT OK — flagged counterparties found' : 'INCOMPLETE — no approval'}</strong>
          <div style={{ marginTop: 8 }}>
            {a.phase === 'trc20' ? 'Reading all token transfer pages…' : a.phase === 'native' ? 'Reading TRX / TRC10 transaction pages…' :
              a.phase === 'screen' ? 'Checking every counterparty against the USDT contract…' : 'Scan finished.'}
          </div>
          <div>{a.pages} history pages · {a.trc20Rows} token records · {a.nativeRows} native transaction records · {a.peers.length} counterparties</div>
          <div>{checked}/{a.peers.length} checked · {hits.length} blocked, sanctioned or manually flagged · {unknown} unavailable</div>
          <progress aria-label="Counterparty screening progress" max={Math.max(1,a.peers.length)}
            value={a.phase === 'trc20' || a.phase === 'native' ? undefined : checked} style={{ width: '100%', marginTop: 10 }} />
        </div>
        <div className="row row-wrap">
          <span>USDT: <strong>{a.balances ? units(a.balances.usdt) : 'unavailable'}</strong>{a.targetStatus === 'blocked' ? ' · frozen by Tether' : ''}</span>
          <span>TRX: <strong>{a.balances ? units(a.balances.trx) : 'unavailable'}</strong></span>
          <span>Address blacklist: <strong>{a.targetStatus}</strong></span>
        </div>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>History snapshot: {new Date(a.before).toLocaleString()}.
          {a.since ? ' From ' + new Date(a.since).toLocaleDateString() + '.' : ' Entire indexed history.'}
          {' '}Status checks are current at each row’s check time, not necessarily at the transfer date.
          {' '}Configured sanctions list: {a.sanctionsUpdatedAt ? 'updated ' + new Date(a.sanctionsUpdatedAt).toLocaleString() : 'freshness not confirmed'}.
        </p>
        <div className="row row-wrap">
          <button className="btn btn-ghost btn-sm" type="button" onClick={csv}>Export counterparties CSV</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => download('KYT-report.json',JSON.stringify(a,null,2),'application/json')}>Export full report</button>
          <label className="check"><input type="checkbox" checked={onlyHits} onChange={e => { setOnlyHits(e.target.checked); setPage(0); }} /> Findings only</label>
          <input className="input mono" placeholder="Filter address" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </div>
        {rows.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th>Counterparty / evidence</th><th>Current status</th><th>USDT received from peer</th><th>USDT sent to peer</th><th>TRX received / sent</th></tr></thead>
          <tbody>{rows.slice(page*20,page*20+20).map(p => <tr key={p.address}>
            <td><a className="mono break" href={explorer(p.address)} target="_blank" rel="noreferrer">{p.address}</a>
              <div className="faint">{p.transfers} transfers · {p.positiveTransfers} positive value</div>
              <details><summary>Transfer evidence ({p.evidence.length} samples)</summary>
                {p.evidence.map((e,i) => <div key={i} style={{ marginTop: 8 }}>
                  <a href={'https://tronscan.org/#/transaction/'+e.hash} target="_blank" rel="noreferrer">
                    {e.direction === 'in' ? 'Received' : 'Sent'} {e.amount} {e.token} · {new Date(e.at).toLocaleString()}
                  </a>
                </div>)}
                {p.transfers > p.evidence.length ? <div>Amounts include all transfers; evidence display keeps up to 20 examples per peer.</div> : null}
              </details>
            </td>
            <td><strong>{p.status || 'Pending'}</strong>{p.sanctioned ? ' · sanctions' : ''}{p.flagged ? ' · manual flag' : ''}
              <div className="faint">{p.checkedAt ? new Date(p.checkedAt).toLocaleString() : ''}</div>
              {problem(p) && p.positiveTransfers === 0 ? <div>Zero-value records only; no positive-value payment established.</div> : null}
            </td>
            <td>{units(p.incomingUsdt)}</td><td>{units(p.outgoingUsdt)}</td>
            <td>{units(p.incomingTrx)} / {units(p.outgoingTrx)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="muted">{onlyHits ? 'No flagged counterparties found so far. Approval requires a completed scan.' : 'No counterparties in this history.'}</p>}
        {rows.length > 20 ? <div className="row">
          <button type="button" className="btn btn-sm" disabled={page===0} onClick={() => setPage(page-1)}>Previous</button>
          <span>{page+1} / {Math.ceil(rows.length/20)}</span>
          <button type="button" className="btn btn-sm" disabled={(page+1)*20>=rows.length} onClick={() => setPage(page+1)}>Next</button>
        </div> : null}
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>
          Scope: confirmed direct transfers returned by TronGrid, current Tether USDT blacklist and your configured sanctions / manual flags.
          Excludes internal contract transfers, indirect tracing, other token issuers and sanctions sources not configured here.
          An OK result is not a guarantee of lawful ownership or future acceptance by an exchange.
        </p>
      </> : null}
    </div>
  </section>;
}
