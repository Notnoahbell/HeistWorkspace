# HeistWorkspace — Project Notes

A lightweight, collaborative **infinite canvas** for video review and tracking.
Functionally a superset of Milanote, built for an internal team of ~150 and
self-hosted.

## Guiding constraints

1. **Feature-complete locally first, backend second.** Every feature is built
   against a local, in-browser store first. The backend replaces the store's
   persistence/sync layer later, without rewriting features.
2. **Extremely lightweight.** React + TypeScript + Vite for the UI, but the
   canvas hot path stays outside React: the camera, grid and card physics
   write straight to the DOM in rAF loops, and React only re-renders when
   board data changes (each card subscribes to its own record only).
3. **Multiplayer-ready from day one.** Even with no server, code is shaped so
   collaboration drops in cleanly (see "Design rules" below).

## Design rules (follow these while building locally)

- **World coordinates everywhere.** Items, cursors and selections are stored in
  world space. Screen space is only used for input and rendering.
  `camera.screenToWorld()` / `camera.worldToScreen()` are the only converters.
- **All board mutations go through one store API** (`addItem`, `updateItem`,
  `removeItem`, ...) as small, serialisable operations. Later this maps 1:1 onto
  a CRDT (Yjs) document, which gives us sync, offline, and undo/redo.
- **Per-frame motion never goes through React or the store.** Drags animate
  imperatively and commit once on settle (later: also broadcast throttled
  positions over presence so others see the drag live).
- **Camera is per-user and local.** Never synced (except for "follow" mode).
- **Presence (cursors, selection, viewport) is ephemeral** and separate from
  board data — it's broadcast, never persisted.
- **IDs are client-generated** (nanoid/UUID) so offline creation never collides.
- **Media is referenced by ID**, never embedded. Local phase uses object URLs /
  IndexedDB blobs; server phase swaps in signed URLs to proxies.

## Feature roadmap

### Phase 1 — Canvas core (local)
- [x] Infinite pan/zoom canvas (mouse, trackpad, touch pinch, keyboard)
- [x] Adaptive dot-grid background
- [x] Item model + store (zustand, persisted to localStorage), DOM items in a world layer
- [x] Comments (text items): inertial drag with 3D tilt, lift and shadow; editable text
- [x] Comment colour + top strip colour: presets, HSV wheel, hex input, eyedropper
- [x] Single selection, z-order on grab, delete
- [x] Snap to the 16px dot grid on drop (throws land exactly on grid; Alt = free; G toggles)
- [x] Columns: stack comments and boards, drop-to-insert with live gap, drag out, carried as a rigid group
- [x] Fixed-width left sidebar with add (click or drag out) and view controls; selecting
      an item slides in its menu (Colour, Strip, Text, Icon, Rename…) whose pop-ups hold
      the settings. The same actions/pop-ups are on a floating toolbar above the item.
- [x] Camera bounds: the view can't wander far past the content (grows with it)
- [x] Board looks: floating = icon square with name + "2 boards, 5 comments" beneath;
      stacked in a column = a row. Dragged boards stay icons; the column shows a
      faded preview row where it will land
- [x] Nested boards: board tiles (colour + Lucide icon), per-board items and camera,
      hash routes (#/b/<id>, Back works), breadcrumb path with overflow menu
- [x] Per-user Home at the root of every user's board tree (local user for now)
- [x] Note text settings: size, alignment, bold
- [x] To-do lists (clickable checkboxes, progress), links with page previews
- [x] Column strip colours
- [x] Box selection, shift-click, Ctrl/⌘+A, group drag, right-click menu
      ("New column from selection", delete; "add here" on empty canvas)
- [x] Nested columns (columns size to their contents) and horizontal columns
- [x] Columns became **sections**: a grid with 1–6 columns (drag the right edge or pick a count)
- [ ] Resize
- [ ] Alignment guides
- [ ] Undo / redo
- [x] Copy / cut / paste / duplicate (not boards; columns bring their contents)
- [x] Drag items into other boards: onto a board tile, or up into a parent via the path
- [ ] Viewport culling (only mount items near the viewport)

### Phase 2 — Milanote parity (local)
- [ ] Rich text in notes, headings
- [x] Photos, GIFs and videos (Upload button, drop from desktop, paste); files TBD
- [ ] Column collapse
- [ ] Lines/arrows connecting items
- [ ] Labels/tags
- [x] Drag-and-drop upload from desktop
- [ ] Board templates, search

### Phase 3 — Video review (where we surpass Milanote)
- [ ] Video cards with scrubbable hover-preview thumbnails
- [x] Comments on notes, to-dos, links, photos and videos; timecoded on videos (frame-accurate still to come)
- [x] Replies, @mentions, notifications (bell + live toast), typing indicators
- [ ] Notifications synced across devices / email digests; comment-only permission
- [ ] Draw-on-frame annotations
- [ ] Version stacks (v1, v2, v3…) and side-by-side / overlay compare
- [ ] Review status workflow (e.g. In progress → Needs review → Changes → Approved)
- [ ] Assignees, due dates, tracking views / filters across boards
- [ ] Playback speed, frame stepping (J/K/L, arrow keys), loop range

### Phase 4 — Collaboration (LAN testing build)
- [x] Sync server (`server/sync.ts`) on this machine: WebSocket `/sync`, whole-item
      upserts/deletes (last write wins per item), state in `data/server-db.json`
- [x] Testing identity: user id = hash of a random per-browser device id (`?as=` to be
      several users). IP-only ids collapse an office behind one public IP into one user.
- [x] Per-user Home; share boards with people (owner only); boards shared with you get a
      shortcut tile on your Home (`linkTo`), and their path starts at your Home
- [x] Live cursors (exact positions, no interpolation) in per-board distinct colours,
      name bubbles, cursor chat ("/", 60 chars), presence avatars, profile name/icon
- [ ] "Follow" a user's viewport; live selection highlights; @mentions
- [ ] Real accounts (SSO) instead of IP identity; per-board permissions (view/edit)
- [ ] Field-level / CRDT merging (Yjs) instead of last-write-wins per item

## Target backend architecture (later)

Sized for ~150 users; a single modest server handles this comfortably.

| Concern        | Plan                                                             |
|----------------|------------------------------------------------------------------|
| Realtime sync  | Yjs CRDT over WebSocket (y-websocket or Hocuspocus)              |
| Presence       | Yjs awareness protocol (cursors, selection, viewport)            |
| Database       | Postgres — users, boards, permissions, comments, review status   |
| Doc storage    | Yjs snapshots/updates persisted in Postgres                      |
| Media storage  | S3-compatible object storage on-prem (MinIO)                     |
| Transcoding    | ffmpeg worker queue → H.264/HLS proxies, thumbnails, sprite sheets |
| Uploads        | Resumable/chunked (tus) direct to object storage                 |
| Auth           | Company SSO (OIDC / SAML)                                        |
| Hosting        | Docker Compose on an internal host behind a reverse proxy        |

## Decisions

- **2026-11-03: UI shell** — a fixed tool rail down the left (raised mini-tile add
  buttons, view controls at the bottom; icons only) that never changes state: all item
  settings live in the floating toolbar above the selection (single item or group).
  People avatars are round, after the Figma reference — an exception to the hard-edge
  rule. The top-left logo is the Heist mark in your cursor colour.
- **2026-11-03: Online testing on Render** (free web service via `render.yaml`).
  The free disk is wiped on restart, so clients re-upload their own boards and
  profile on connect; ids don't depend on server state. Needs a persistent disk
  or database before real use.
- **2026-11-03: LAN-first collaboration.** The sync server runs on one machine
  (dev server plugin, or `server/index.ts` in production) rather than a hosted
  service; GitHub holds the code. Public hosting is a later decision — GitHub
  Pages alone can't host the sync server or link previews.
- **2026-11-03: "Comments" are now "notes"** (data migrated, v3). "Comment" is
  reserved for timecoded video review comments later.
- **2026-11-03: Link previews** come from `/api/unfurl` (`server/unfurl.ts`, a Vite
  dev-server plugin for now). It only fetches public http(s) addresses, checks every
  redirect hop, times out at 6s and reads at most 768KB. When it moves to the
  backend, also pin the resolved IP for the request (DNS-rebinding), rate-limit it,
  and consider proxying preview images.
- **2026-11-03: Photos/GIFs/videos** upload to `PUT /api/upload` (`server/uploads.ts`,
  raw body, Content-Type = file type) and are stored in `data/uploads`, served from
  `/uploads/<random id>.<ext>` with Range support so videos seek. PNG/JPEG/GIF/WebP/AVIF/
  MP4/WebM/MOV only (no SVG — same-origin script), up to 1 GB, `nosniff`. A card appears
  at once with a local blob preview and progress; the item's `src` is set when the upload
  finishes, so other people only see it once it's on the server. No auth or cleanup of
  orphaned files yet — swap for object storage + signed URLs with the real backend.
- **2026-11-03: Board squares** are 64px with Figma-style 60% corner smoothing
  (`figma-squircle` clip-path; lift shadow drawn as a filter so it follows the curve).

- **2026-11-03: Visual language** — hard edges everywhere (no border radius),
  except the colour wheel disc and board icon squares (smoothed corners, same
  64px size floating and in columns), theme follows the OS light/dark
  setting live. Single pointer mode: no hand tool; empty-canvas drag pans.
  (Box selection, when built, will need a modifier such as Shift+drag.)
- **2026-11-03: React (web), not vanilla JS and not React Native.** The app is
  mostly UI (comments, review panels, player controls), where React pays off.
  Mobile will be a responsive web app or PWA.
- **2026-11-03: Left-drag on empty canvas = box selection** (it used to pan). Mouse
  panning is Space-drag, middle-drag or the wheel; touch still pans with one finger.
- **2026-11-03: Columns nest.** Every item kind is stackable; a column sizes itself
  to its contents (so nesting widens the parent) and cards in vertical columns
  stretch to its inner width. Stacked surfaces alternate tone by depth.
- **2026-11-03: Comments are items** (`kind: 'comment'`, `targetId`, `time` for
  videos), on the same board as their target, so sync, sharing and per-comment
  last-write-wins come from the existing item sync. They're never drawn on the
  canvas (`onCanvas()` filters them from select-all, box select, bounds, counts),
  are deleted with their target and follow it to other boards. Resolving keeps
  them (`resolved`, `resolvedBy`) under a Resolved tab. With the real backend,
  consider a per-target index and comment-only permissions (comment without edit).
- **2026-11-03: Replies, mentions, notifications, typing.** A reply is a comment with
  `replyTo` (its thread's first comment); resolving/deleting the first comment covers the
  thread, and badges count threads. `@Name` picks from the board's members (Home owner +
  `sharedWith` up the chain) and stores their ids in `mentions`. Notifications are derived
  on each client from the comments it can see (mentions of you, replies in threads you
  wrote in); read state is per browser for now (`heist:notices`). "Typing" rides on
  presence (`typing: <itemId>`), so it's per board and never stored.
- **2026-11-03: Columns → sections (grid).** The vertical/horizontal switch is gone;
  a section has `cols` (1 = a plain column) and fills left to right, wrapping, each
  row as tall as its tallest item. Cells are one card wide, or as wide as the widest
  nested section. Drag the right edge to change the count, or use the toolbar's
  Columns picker. Data v5: vertical → 1, horizontal → one column per item. Code
  still calls the kind `column`; only the UI says "section".

- **2026-11-03: Boards are items.** All items live in one flat map tagged with
  `boardId`; a board's tile *is* the board. Each user's root is a virtual Home
  (`home:<userId>`). When the backend arrives, split into one Yjs doc per board.
- **2026-11-03: Icons come from Lucide** (ISC licence), a curated ~160-icon set.
  Requested: switch to **Font Awesome Duotone Solid** — blocked on a Font Awesome
  Pro licence/npm token (Duotone isn't in the free set). Boards store icon *names*,
  so the swap is a name→icon mapping in `src/lib/icons.ts`.
- **2026-11-03: Board icons are guessed from the name** (`src/lib/iconGuess.ts`)
  unless one is chosen; `icon: null` means "automatic".

## Open questions

- Max upload size / typical clip lengths and codecs (drives transcoding).
- Retention policy and who can see which boards.

## Running locally

See README.md. `npm run dev` includes the sync server; `npm run lan` builds and
serves everything on port 8080 for people on the network.

Requires Node (installed per-user at `%LOCALAPPDATA%\Programs\nodejs`).

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

### Code map
- `src/canvas/` — camera, dot grid, pan/zoom input, `<Canvas>` (non-React hot path)
- `src/board/` — board store (document), UI store (local), layout store (derived),
  `body.ts` physics shared by all items, item views, `actions.ts` behaviours/commands
- `src/board/nav.ts` — which board is open (URL hash), breadcrumb paths
- `src/ui/` — top bar, sidebar, floating toolbar, pop-up panels (`panels.tsx` = shared
  actions + settings), colour wheel, board icons
- `src/session.ts` — current user and their Home board id
- `src/lib/` — colour maths, ID generation

### Controls
- Pan: scroll / two-finger drag, Space + drag, middle-mouse drag; one-finger drag on touch
- Select: drag on empty canvas to box-select (Shift adds); Shift-click toggles; Ctrl/⌘+A all;
  right-click for actions; drag any selected item to move the group
- Zoom: Ctrl/⌘ + scroll, trackpad pinch, touch pinch, Ctrl/⌘ + `+` / `-`
- Reset to 100%: Ctrl/⌘ + 0, or click the zoom readout
- Click a selected item again (or double-click) for its main action: edit a note / to-do /
  column title, open a board, open a link
- Notes: double-click canvas or N; Enter also edits; Esc to stop
- Links: L (type a URL, Enter); click it again to open it. To-dos: T; tick boxes any time
- Photos/videos: Upload in the rail, drop files onto the board, or paste an image. Name
  defaults to the filename — click the name of a selected card to rename; the arrow
  hides/shows the name and details. ▶ plays a video in place; drag its timeline to scrub.
  GIFs loop on their own. Double-click (or Enter) opens the full-size player: Space/K
  play-pause, ←/→ 5s, , and . one frame, M mute, F full screen, Esc close. Click the time
  readout to switch to frame numbers; speed menu 0.25×–2×; , and . also step a selected card's video (assumes 24 fps until the backend reads the real rate)
- Comments: the toolbar's comment button opens a comment box beside the item; once it has
  comments, up to 5 open ones show beside it whenever it's selected (Enter posts, Shift+Enter new line); "Show all" opens Open/Resolved tabs; the
  tick resolves, ↺ reopens. On a video the comment is pinned to the card's current time
  (click the time chip for a whole-video comment); click a timecode to jump there. The
  player lists every comment beside the video, with marks on the timeline. Reply under any
  comment; type @ to mention someone who can see the board (↑/↓, Enter). The bell (top
  right) lists mentions and replies; clicking one opens the board and selects the item
- Sections: S (or C); double-click header to rename; double-click body to add a note;
  drag the right edge to change the number of grid columns
- Sidebar Add buttons: click to add at centre, or drag the button out — a preview tile
  follows the cursor and becomes a real item once it clears the sidebar
- Drag and flick to throw; Delete removes; G toggles snap, hold Alt to place freely
- Boards: B, or drag from the sidebar; double-click / Enter to open; Alt+↑ goes up a level;
  click the centred board name for its settings
- Copy / cut / paste / duplicate: Ctrl/⌘ + C / X / V / D (right-click → Paste here)
- Move into another board: drag onto a board tile, or onto a board in the top-bar path
- Zoom to fit: Shift+1
