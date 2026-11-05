import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// "v3 ▾": pick a version of a video. Used in the player's top bar (which
// version you're watching, where versions can also be renamed, restored or
// deleted) and on the compare pane (which one to set beside it). Also the
// review-status picker ("● Approved ▾").
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { deleteVersion, renameVersion, restoreVersion, STATUSES, statusInfo, versionList } from '../board/versions';
import { timeAgo } from '../board/comments';
import { byLine } from '../lib/time';
import { useUi } from '../board/ui';
import { usePresence } from '../sync/presence';
import { session } from '../session';
/** Close on a press outside or Escape. */
function useDismiss(open, ref, close) {
    useEffect(() => {
        if (!open)
            return;
        const away = (e) => { if (!ref.current?.contains(e.target))
            close(); };
        const key = (e) => { if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        } };
        window.addEventListener('pointerdown', away, true);
        window.addEventListener('keydown', key, true);
        return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
    }, [open]);
}
export function VersionMenu({ media, value, onPick, disabled, className, label, manage }) {
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const ref = useRef(null);
    const users = usePresence((s) => s.users);
    const list = versionList(media);
    useDismiss(open, ref, () => { setOpen(false); setRenaming(null); setConfirm(null); });
    const who = (id) => (!id ? null : id === session.userId ? 'you' : users[id]?.name ?? null);
    const toast = (text) => useUi.getState().set({ toast: { text, at: Date.now() } });
    return (_jsxs("div", { ref: ref, className: `version-menu ${className ?? ''}`, children: [_jsxs("button", { className: "version-btn", "aria-haspopup": "menu", "aria-expanded": open, title: "Versions", onClick: () => setOpen((o) => !o), children: [label ?? `v${value}`, _jsx(ChevronDown, { size: 14, strokeWidth: 2.4, "aria-hidden": "true" })] }), open && (_jsx("div", { className: "version-list", role: "menu", children: list.map((v) => {
                    const by = who(v.addedBy);
                    const st = statusInfo(v.status);
                    return (_jsxs("div", { className: "version-row", "data-checked": v.n === value || undefined, children: [renaming === v.n ? (_jsxs("form", { className: "version-rename", onSubmit: (e) => {
                                    e.preventDefault();
                                    renameVersion(media.id, v.n, new FormData(e.currentTarget).get('label'));
                                    setRenaming(null);
                                }, children: [_jsxs("span", { className: "version-n", children: ["v", v.n] }), _jsx("input", { name: "label", defaultValue: v.label ?? '', placeholder: v.name || 'Name this version', autoFocus: true, maxLength: 60, onKeyDown: (e) => { if (e.key === 'Escape') {
                                            e.stopPropagation();
                                            setRenaming(null);
                                        } } }), _jsx("button", { type: "submit", className: "version-act", "aria-label": "Save name", children: _jsx(Check, { size: 14, strokeWidth: 2.6, "aria-hidden": "true" }) })] })) : (_jsxs("button", { className: "version-pick", role: "menuitemradio", "aria-checked": v.n === value, disabled: disabled?.includes(v.n), onClick: () => { onPick(v.n); setOpen(false); }, title: [`v${v.n}: ${v.label || v.name || 'Untitled'}`, v.label ? v.name : '', v.addedAt || by ? `Added by ${byLine(by || 'someone', v.addedAt)}` : ''].filter(Boolean).join('\n'), children: [_jsxs("span", { className: "version-n", children: ["v", v.n] }), _jsxs("span", { className: "version-text", children: [_jsx("span", { className: "version-name", children: v.label || v.name || 'Untitled' }), _jsxs("span", { className: "version-sub", children: [st && _jsx("span", { className: "review-dot", style: { background: st.color }, title: st.label }), v.current ? 'Current' : 'Earlier', v.label ? ` · ${v.name}` : '', v.addedAt ? ` · ${timeAgo(v.addedAt)}` : '', by ? ` · ${by}` : ''] })] }), v.n === value && _jsx(Check, { size: 14, strokeWidth: 2.6, "aria-hidden": "true" })] })), manage && renaming !== v.n && (_jsxs("span", { className: "version-acts", children: [_jsx("button", { className: "version-act", title: "Rename", "aria-label": `Rename v${v.n}`, onClick: () => setRenaming(v.n), children: _jsx(Pencil, { size: 13, strokeWidth: 2.2, "aria-hidden": "true" }) }), !v.current && (_jsx("button", { className: "version-act", title: `Restore as v${list.length + 1}`, "aria-label": `Restore v${v.n}`, onClick: () => { const n = restoreVersion(media.id, v.n); if (n) {
                                            toast(`v${v.n} restored as v${n}`);
                                            onPick(n);
                                            setOpen(false);
                                        } }, children: _jsx(RotateCcw, { size: 13, strokeWidth: 2.2, "aria-hidden": "true" }) })), list.length > 1 && (_jsxs("button", { className: "version-act version-del", "data-confirm": confirm === v.n || undefined, title: confirm === v.n ? 'Click again to delete this version and its comments' : 'Delete version', "aria-label": confirm === v.n ? `Confirm delete v${v.n}` : `Delete v${v.n}`, onClick: () => {
                                            if (confirm !== v.n) {
                                                setConfirm(v.n);
                                                return;
                                            }
                                            deleteVersion(media.id, v.n);
                                            toast(`v${v.n} deleted`);
                                            setConfirm(null);
                                        }, children: [_jsx(Trash2, { size: 13, strokeWidth: 2.2, "aria-hidden": "true" }), confirm === v.n && _jsx("span", { children: "Delete?" })] }))] }))] }, v.n));
                }) }))] }));
}
/** "● Approved ▾": where the review of a version stands. */
export function StatusMenu({ value, onChange, className }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useDismiss(open, ref, () => setOpen(false));
    const cur = statusInfo(value);
    return (_jsxs("div", { ref: ref, className: `version-menu status-menu ${className ?? ''}`, children: [_jsxs("button", { className: "version-btn", "aria-haspopup": "menu", "aria-expanded": open, title: "Review status", onClick: () => setOpen((o) => !o), children: [_jsx("span", { className: "review-dot", style: { background: cur?.color ?? 'transparent' }, "data-none": !cur || undefined }), cur?.label ?? 'No status', _jsx(ChevronDown, { size: 14, strokeWidth: 2.4, "aria-hidden": "true" })] }), open && (_jsx("div", { className: "version-list status-list", role: "menu", children: [...STATUSES, null].map((s) => (_jsxs("button", { className: "version-pick", role: "menuitemradio", "aria-checked": (s?.value ?? null) === value, onClick: () => { onChange(s?.value ?? null); setOpen(false); }, children: [_jsx("span", { className: "review-dot", style: { background: s?.color ?? 'transparent' }, "data-none": !s || undefined }), _jsx("span", { className: "version-name", children: s?.label ?? 'No status' }), (s?.value ?? null) === value && _jsx(Check, { size: 14, strokeWidth: 2.6, "aria-hidden": "true" })] }, s?.value ?? 'none'))) }))] }));
}
