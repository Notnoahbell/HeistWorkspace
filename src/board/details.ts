// What a card's hover tooltip says beyond what's on it: who added it and when,
// and the facts that don't fit on the card.

import { usePresence } from '../sync/presence';
import { session } from '../session';
import { byLine } from '../lib/time';
import type { Item, MediaMeta } from './store';
import { fmtTime } from '../ui/Scrubber';
import { fmtSize } from './media';

/** "Added by Noah Bell • Nov 4, 2026 at 1:22 PM", or '' when it isn't known. */
export function useAddedBy(item: Item | undefined, label = 'Added by'): string {
  // For a video with versions, the version on show: who added it and when.
  const who = item?.kind === 'media' && item.versions?.length ? item.versionBy ?? item.createdBy : item?.createdBy;
  const when = item?.kind === 'media' && item.versions?.length ? item.versionAt ?? item.createdAt : item?.createdAt;
  const name = usePresence((s) => (who ? s.users[who]?.name ?? (who === session.userId ? s.me?.name : null) ?? null : null));
  if (!who && !when) return '';
  return `${label} ${byLine(name ?? 'someone', when)}`;
}

/** Everything known about a photo or video's file, on one line. */
export function mediaFacts(meta: MediaMeta, kind: 'image' | 'video'): string {
  const type = meta.mime?.split('/')[1]?.replace('quicktime', 'MOV').replace('jpeg', 'JPG').toUpperCase();
  const size = fmtSize(meta.size);
  return [
    type,
    meta.width && meta.height ? `${meta.width}×${meta.height}` : '',
    kind === 'video' && meta.duration ? fmtTime(meta.duration) : '',
    kind === 'video' && meta.fps ? `${meta.fps} fps` : '',
    size,
  ].filter(Boolean).join(' · ');
}
