// The Downloads panel, bottom right: every download in the queue with its own
// progress bar (waiting, downloading with %, saved, failed with retry). Closes
// itself a few seconds after everything's saved; minimise or close any time.

import { useState, type CSSProperties } from 'react';
import { Check, ChevronDown, ChevronUp, Download as DownloadIcon, FileImage, FileVideo, RotateCw, X } from 'lucide-react';
import { cancelDownload, clearFinished, closeDownloads, retryDownload, useDownloads, type Download } from '../board/download';
import { fmtSize } from '../board/media';

const ICON = { size: 15, strokeWidth: 2, 'aria-hidden': true } as const;

export function Downloads() {
  const { list, open } = useDownloads();
  const [small, setSmall] = useState(false);
  if (!open || !list.length) return null;
  const active = list.filter((d) => d.status === 'queued' || d.status === 'downloading' || d.status === 'saving');
  const done = list.filter((d) => d.status === 'done').length;
  const failed = list.filter((d) => d.status === 'failed').length;
  // Overall: bytes where known, else by count.
  const known = list.filter((d) => d.status !== 'cancelled');
  const total = known.reduce((n, d) => n + (d.total || 0), 0);
  const got = known.reduce((n, d) => n + (d.status === 'done' ? d.total || d.got : d.got), 0);
  const overall = total ? got / total : known.length ? done / known.length : 1;
  const title = active.length
    ? `Downloading ${active.length === 1 ? '1 file' : `${active.length} files`}`
    : failed ? `${failed} ${failed === 1 ? 'download' : 'downloads'} failed` : `Saved ${done} ${done === 1 ? 'file' : 'files'} to Downloads`;

  return (
    <section className="downloads" aria-label="Downloads" data-small={small || undefined}>
      <header className="downloads-head">
        <span className="downloads-glyph" data-busy={active.length > 0 || undefined}><DownloadIcon {...ICON} /></span>
        <span className="downloads-title">{title}</span>
        <button className="downloads-btn" onClick={() => setSmall((s) => !s)} title={small ? 'Show the list' : 'Minimise'} aria-label={small ? 'Show the list' : 'Minimise'}>
          {small ? <ChevronUp {...ICON} /> : <ChevronDown {...ICON} />}
        </button>
        <button
          className="downloads-btn"
          onClick={() => { if (active.length) closeDownloads(); else clearFinished(); }}
          title={active.length ? 'Hide (downloads carry on)' : 'Close'}
          aria-label="Close"
        >
          <X {...ICON} />
        </button>
      </header>
      <div className="downloads-overall" style={{ '--p': overall } as CSSProperties} aria-hidden="true"><i /></div>
      {!small && (
        <ul className="downloads-list">
          {list.map((d) => <Row key={d.id} d={d} />)}
        </ul>
      )}
    </section>
  );
}

function Row({ d }: { d: Download }) {
  const frac = d.status === 'done' || d.status === 'saving' ? 1 : d.total ? Math.min(1, d.got / d.total) : 0;
  const sub = d.status === 'queued' ? 'Waiting…'
    : d.status === 'downloading' ? `${Math.round(frac * 100)}% · ${fmtSize(d.got)}${d.total ? ` of ${fmtSize(d.total)}` : ''}`
    : d.status === 'saving' ? 'Saving…'
    : d.status === 'done' ? `Saved · ${fmtSize(d.total || d.got)}`
    : d.status === 'failed' ? (d.error ?? 'Failed')
    : 'Cancelled';
  return (
    <li className="downloads-row" data-status={d.status}>
      <span className="downloads-kind">{d.kind === 'video' ? <FileVideo {...ICON} /> : <FileImage {...ICON} />}</span>
      <span className="downloads-info">
        <span className="downloads-name" title={d.name}>{d.name}</span>
        <span className="downloads-bar" style={{ '--p': frac } as CSSProperties} data-indeterminate={d.status === 'downloading' && !d.total || undefined}><i /></span>
        <span className="downloads-sub">{sub}</span>
      </span>
      {d.status === 'done' ? <span className="downloads-done" aria-label="Saved"><Check {...ICON} /></span>
        : d.status === 'failed' ? <button className="downloads-btn" onClick={() => retryDownload(d.id)} title="Try again" aria-label="Try again"><RotateCw {...ICON} /></button>
        : d.status === 'cancelled' ? null
        : <button className="downloads-btn" onClick={() => cancelDownload(d.id)} title="Cancel" aria-label="Cancel"><X {...ICON} /></button>}
    </li>
  );
}
