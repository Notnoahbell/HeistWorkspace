// Who's here: the user directory, your profile, and other people's cursors.
// Ephemeral and local — never persisted with the board.

import { create } from 'zustand';
import type { Point } from '../canvas/camera';
import { session } from '../session';

/** Cursor colours (the same set the server hands out per board). */
const PALETTE = [
  '#E5484D', '#F76B15', '#E2A300', '#30A46C', '#12A594', '#0090FF',
  '#3E63DD', '#8E4EC6', '#D6409F', '#7C5E46', '#5F6B7A', '#29A383',
];

/**
 * The colour you always see yourself in (logo, your avatar, your chat
 * bubble): fixed per user, so it's the same on every board and every visit.
 * Others see you in whatever colour the server picks for that board.
 */
export function personalColor(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export interface Profile { id: string; name: string; icon: string | null }

export interface Peer {
  connId: string;
  userId: string;
  name: string;
  icon: string | null;
  color: string;
  boardId: string | null;
  /** World position of their cursor; null when it's off the canvas. */
  at: Point | null;
  /** Cursor chat: shown in place of their name while non-empty. */
  msg: string;
  /** Item they're writing a comment on, if any. */
  typing?: string | null;
  /** What they have selected. */
  sel?: string[];
}

interface PresenceState {
  status: 'offline' | 'connecting' | 'online';
  me: Profile | null;
  /** The colour others see you in on the current board (assigned by the server). */
  myColor: string | null;
  users: Record<string, Profile>;
  peers: Record<string, Peer>;
}

export const usePresence = create<PresenceState>()(() => ({
  status: 'offline',
  me: null,
  myColor: null,
  users: {},
  peers: {},
}));

/** Your own colour, as you see yourself (see personalColor). */
export const useMyColor = () => usePresence((s) => personalColor(s.me?.id ?? session.userId));
