import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The Downloads panel, bottom right: every download in the queue with its own
// progress bar (waiting, downloading with %, saved, failed with retry). Closes
// itself a few seconds after everything's saved; minimise or close any time.
import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Download as DownloadIcon, FileImage, FileVideo, RotateCw, X } from 'lucide-react';
import { cancelDownload, clearFinished, closeDownloads, retryDownload, useDownloads } from '../board/download';
import { fmtSize } from '../board/media';
const ICON = { size: 15, strokeWidth: 2, 'aria-hidden': true };
export function Downloads() {
    const { list, open } = useDownloads();
    const [small, setSmall] = useState(false);
    if (!open || !list.length)
        return null;
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
    return (_jsxs("section", { className: "downloads", "aria-label": "Downloads", "data-small": small || undefined, children: [_jsxs("header", { className: "downloads-head", children: [_jsx("span", { className: "downloads-glyph", "data-busy": active.length > 0 || undefined, children: _jsx(DownloadIcon, { ...ICON }) }), _jsx("span", { className: "downloads-title", children: title }), _jsx("button", { className: "downloads-btn", onClick: () => setSmall((s) => !s), title: small ? 'Show the list' : 'Minimise', "aria-label": small ? 'Show the list' : 'Minimise', children: small ? _jsx(ChevronUp, { ...ICON }) : _jsx(ChevronDown, { ...ICON }) }), _jsx("button", { className: "downloads-btn", onClick: () => { if (active.length)
                            closeDownloads();
                        else
                            clearFinished(); }, title: active.length ? 'Hide (downloads carry on)' : 'Close', "aria-label": "Close", children: _jsx(X, { ...ICON }) })] }), _jsx("div", { className: "downloads-overall", style: { '--p': overall }, "aria-hidden": "true", children: _jsx("i", {}) }), !small && (_jsx("ul", { className: "downloads-list", children: list.map((d) => _jsx(Row, { d: d }, d.id)) }))] }));
}
function Row({ d }) {
    const frac = d.status === 'done' || d.status === 'saving' ? 1 : d.total ? Math.min(1, d.got / d.total) : 0;
    const sub = d.status === 'queued' ? 'Waiting…'
        : d.status === 'downloading' ? `${Math.round(frac * 100)}% · ${fmtSize(d.got)}${d.total ? ` of ${fmtSize(d.total)}` : ''}`
            : d.status === 'saving' ? 'Saving…'
                : d.status === 'done' ? `Saved · ${fmtSize(d.total || d.got)}`
                    : d.status === 'failed' ? (d.error ?? 'Failed')
                        : 'Cancelled';
    return (_jsxs("li", { className: "downloads-row", "data-status": d.status, children: [_jsx("span", { className: "downloads-kind", children: d.kind === 'video' ? _jsx(FileVideo, { ...ICON }) : _jsx(FileImage, { ...ICON }) }), _jsxs("span", { className: "downloads-info", children: [_jsx("span", { className: "downloads-name", title: d.name, children: d.name }), _jsx("span", { className: "downloads-bar", style: { '--p': frac }, "data-indeterminate": d.status === 'downloading' && !d.total || undefined, children: _jsx("i", {}) }), _jsx("span", { className: "downloads-sub", children: sub })] }), d.status === 'done' ? _jsx("span", { className: "downloads-done", "aria-label": "Saved", children: _jsx(Check, { ...ICON }) })
                : d.status === 'failed' ? _jsx("button", { className: "downloads-btn", onClick: () => retryDownload(d.id), title: "Try again", "aria-label": "Try again", children: _jsx(RotateCw, { ...ICON }) })
                    : d.status === 'cancelled' ? null
                        : _jsx("button", { className: "downloads-btn", onClick: () => cancelDownload(d.id), title: "Cancel", "aria-label": "Cancel", children: _jsx(X, { ...ICON }) })] }));
}
