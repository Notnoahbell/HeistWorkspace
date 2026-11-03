// Who's here: the user directory, your profile, and other people's cursors.
// Ephemeral and local — never persisted with the board.

import { create } from 'zustand';
import type { Point } from '../canvas/camera';

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
}

interface PresenceState {
  status: 'offline' | 'connecting' | 'online';
  me: Profile | null;
  /** Your cursor colour on the current board (assigned by the server). */
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
