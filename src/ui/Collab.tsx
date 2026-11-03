// Top-right of the top bar: who's here, boards shared with you, sharing the
// open board, and your profile (name + icon).

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, Link2, Share2 } from 'lucide-react';
import { useBoard, type Board } from '../board/store';
import { useBoardId } from '../board/nav';
import { isHome, session } from '../session';
import { BOARD_ICONS } from '../lib/icons';
import { useMyColor, usePresence, type Peer, type Profile } from '../sync/presence';
import { camera } from '../canvas/camera';
import { setProfile } from '../sync/client';

const ICON = { size: 16, strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true } as const;
const PROFILE_ICONS = [
  'Smile', 'Star', 'Heart', 'Flame', 'Zap', 'Rocket', 'Camera', 'Film', 'Clapperboard', 'Music',
  'Palette', 'Brush', 'PenTool', 'Coffee', 'Pizza', 'Cat', 'Dog', 'Bird', 'Fish', 'Ghost',
  'Crown', 'Gem', 'Leaf', 'Sun', 'Moon', 'Mountain', 'Gamepad2', 'Atom',
];

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

export function Avatar({ profile, color, size = 26 }: { profile: Pick<Profile, 'name' | 'icon'>; color?: string | null; size?: number }) {
  const Icon = profile.icon ? BOARD_ICONS[profile.icon] : null;
  return (
    <span className="avatar" style={{ width: size, height: size, background: color ?? 'var(--accent)' }} title={profile.name}>
      {Icon ? <Icon size={size * 0.55} strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" /> : initials(profile.name)}
    </span>
  );
}

function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

function Popover({ button, label, children }: { button: (open: boolean, toggle: () => void) => ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(ref, open, close);
  return (
    <div className="top-pop" ref={ref}>
      {button(open, () => setOpen((v) => !v))}
      {open && <div className="top-pop-panel" role="dialog" aria-label={label}>{children(close)}</div>}
    </div>
  );
}

const STACK_MAX = 4;

/** Jump the view to someone's cursor. */
function goTo(p: Peer) {
  if (p.at) camera.centerOn(p.at.x, p.at.y, camera.z, camera.width, camera.height);
}

function PersonButton({ peer, onPick }: { peer: Peer; onPick?: () => void }) {
  return (
    <button
      className="here-person"
      title={peer.at ? `${peer.name} — click to go to their cursor` : `${peer.name} (cursor off the board)`}
      aria-label={`Go to ${peer.name}`}
      onClick={() => { goTo(peer); onPick?.(); }}
    >
      <Avatar profile={peer} color={peer.color} size={28} />
    </button>
  );
}

/**
 * People on this board right now: overlapping circles that fan out on hover.
 * Click someone to jump to their cursor.
 */
function HereNow() {
  const boardId = useBoardId();
  const peers = usePresence(useShallow((s) => {
    const seen = new Set<string>();
    return Object.values(s.peers).filter((p) => p.boardId === boardId && !seen.has(p.userId) && seen.add(p.userId));
  }));
  if (!peers.length) return null;
  const shown = peers.slice(0, STACK_MAX);
  const rest = peers.slice(STACK_MAX);
  return (
    <div className="here-now" aria-label={`${peers.length} other ${peers.length === 1 ? 'person' : 'people'} here`}>
      {shown.map((p) => <PersonButton key={p.userId} peer={p} />)}
      {rest.length > 0 && (
        <Popover
          label="Everyone here"
          button={(open, toggle) => (
            <button className="here-person here-more" aria-expanded={open} onClick={toggle} title={`${rest.length} more`}>
              +{rest.length}
            </button>
          )}
        >
          {(close) => (
            <>
              <h3>Everyone here</h3>
              {peers.map((p) => (
                <button key={p.userId} className="pop-row" onClick={() => { goTo(p); close(); }}>
                  <Avatar profile={p} color={p.color} size={22} />
                  <span>{p.name}</span>
                </button>
              ))}
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

/** Is this board in your own Home tree (so you own it and can share it)? */
function ownsBoard(items: Record<string, unknown>, boardId: string) {
  const all = items as Record<string, Board>;
  for (let b: string | undefined = boardId, guard = 0; b && guard < 64; guard++) {
    if (isHome(b)) return b === `home:${session.userId}`;
    b = all[b]?.boardId;
  }
  return false;
}

/** Share the open board with other people. */
function ShareBoard() {
  const boardId = useBoardId();
  const board = useBoard((s) => (s.items[boardId]?.kind === 'board' ? s.items[boardId] as Board : null));
  const owns = useBoard((s) => ownsBoard(s.items, boardId));
  const online = usePresence((s) => s.status === 'online');
  const others = usePresence(useShallow((s) => Object.values(s.users).filter((u) => u.id !== session.userId)));
  const [copied, setCopied] = useState(false);
  if (!board || !owns) return null;

  const shared = board.sharedWith ?? [];
  const toggle = (id: string) => useBoard.getState().updateItem(board.id, {
    sharedWith: shared.includes(id) ? shared.filter((u) => u !== id) : [...shared, id],
  });

  return (
    <Popover
      label="Share board"
      button={(open, toggleOpen) => (
        <button className="top-btn top-share" aria-expanded={open} onClick={toggleOpen} disabled={!online} title={online ? 'Share this board' : 'Sharing needs the sync server'}>
          <Share2 {...ICON} />
          <span>Share</span>
          {shared.length > 0 && <span className="top-badge">{shared.length}</span>}
        </button>
      )}
    >
      {() => (
        <>
          <h3>Share “{board.title || 'Untitled board'}”</h3>
          <p className="pop-note">People you add can see and edit everything in this board.</p>
          {others.length === 0 && <p className="pop-empty">Nobody else has opened Heist Workspace yet. Send teammates this page's address.</p>}
          {others.map((u) => (
            <button key={u.id} className="pop-row" role="checkbox" aria-checked={shared.includes(u.id)} onClick={() => toggle(u.id)}>
              <Avatar profile={u} size={22} />
              <span>{u.name}</span>
              <span className="pop-check">{shared.includes(u.id) && <Check {...ICON} size={14} />}</span>
            </button>
          ))}
          <button
            className="pop-link"
            onClick={async () => {
              try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
            }}
          >
            <Link2 {...ICON} /> {copied ? 'Link copied' : 'Copy link to this board'}
          </button>
        </>
      )}
    </Popover>
  );
}

/** Your name and icon, as others see them. */
function ProfileMenu() {
  const me = usePresence((s) => s.me);
  const status = usePresence((s) => s.status);
  const color = useMyColor();
  const [name, setName] = useState(me?.name ?? '');
  useEffect(() => setName(me?.name ?? ''), [me?.name]);
  const profile = me ?? { id: session.userId, name: 'You', icon: null };

  return (
    <Popover
      label="Your profile"
      button={(open, toggle) => (
        <button className="top-btn top-profile" aria-expanded={open} onClick={toggle} title={`${profile.name} (${status})`}>
          <Avatar profile={profile} color={color} size={26} />
          <span className="status-dot" data-status={status} />
        </button>
      )}
    >
      {() => (
        <>
          <h3>Your profile</h3>
          {status !== 'online' && <p className="pop-note">Offline — changes are saved on this computer and sync when the server is back.</p>}
          <label className="pop-field">
            <span>Name</span>
            <input
              className="panel-input"
              value={name}
              maxLength={32}
              disabled={!me}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (name.trim() && name !== me?.name) setProfile({ name: name.trim() }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
          </label>
          <div className="pop-field">
            <span>Icon</span>
            <div className="profile-icons">
              <button aria-pressed={!profile.icon} onClick={() => setProfile({ icon: null })} title="Initials" disabled={!me}>
                <Avatar profile={{ ...profile, icon: null }} size={26} />
              </button>
              {PROFILE_ICONS.map((n) => (
                <button key={n} aria-pressed={profile.icon === n} onClick={() => setProfile({ icon: n })} title={n} disabled={!me}>
                  <Avatar profile={{ ...profile, icon: n }} size={26} />
                </button>
              ))}
            </div>
          </div>
          <p className="pop-note">Testing build: there are no logins yet — you're recognised by this browser.</p>
        </>
      )}
    </Popover>
  );
}

export function CollabBar() {
  return (
    <div className="top-right">
      <HereNow />
      <ShareBoard />
      <ProfileMenu />
    </div>
  );
}
