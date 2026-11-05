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
  are deleted with their target and follow it to other boards. (Resolving was
  dropped on 2026-11-04: every comment shows; old `resolved` flags are ignored.) With the real backend,
  consider a per-target index and comment-only permissions (comment without edit).
- **2026-11-03: Replies, mentions, notifications, typing.** A reply is a comment with
  `replyTo` (its thread's first comment); resolving/deleting the first comment covers the
  thread, and badges count threads. `@Name` picks from the board's members (Home owner +
  `sharedWith` up the chain) and stores their ids in `mentions`. Notifications are derived
  on each client from the comments it can see (mentions of you, replies in threads you
  wrote in); read state is per browser for now (`heist:notices`). "Typing" rides on
  presence (`typing: <itemId>`), so it's per board and never stored.
- **2026-11-03: One conversation per item, threads only on video.** Notes, links, to-dos
  and photos have a single flat conversation like Milanote (oldest first, Reply at the end
  opens the box). Videos keep a thread per moment,
  with replies folded away. Same data either way (`isThreaded` decides how it's shown), so
  existing replies just flatten in. Another person's comment after yours in a conversation
  notifies you like a reply.
- **2026-11-04: Video versions.** Drop a video card onto another to make it the new
  version (v2, v3…). The target keeps its id, place and comments; earlier files go in
  `versions` (oldest first) and the item itself is always the newest, so everything that
  draws a card is unchanged. Comments carry `version` (unset = 1); the card and its panel
  show the current version's, the player the one being viewed. The dragged card's own
  history and comments are appended and renumbered. Compare in the player plays two
  versions side by side, the right one following the left (muted). A video file dropped
  from the desktop onto a video card becomes its next version too. Versions can be
  renamed (`label`), restored (copied back on top as a new version, comments stay put)
  and deleted (its comments go; later versions and theirs move down one). Each version
  has a review status (`status`: review / changes / approved), shown as a tag on the card.
- **2026-11-05: Player.** Skip to start / end sit either side of Play (Home / End keys).
- **2026-11-04: Review tools.** A comment can cover a range (`timeEnd`) and carry a
  drawing (`drawing`: shapes in 0–1 picture coordinates, so they fit any size). The comment
  being written in the player lives in a small local draft store (Annotate.tsx) the comment
  box reads when it posts. Frame rate, poster, filmstrip and a proxy come from
  /api/derive (ffprobe/ffmpeg on the server; FFMPEG_PATH / FFPROBE_PATH to point
  elsewhere); cards hover-scrub with the filmstrip. Resolving comments was removed.
- **2026-11-03: Reactions.** Six fixed emoji (👍 🔥 ❤️ 😂 💯 👎) stored on the comment as
  `reactions: { emoji: userId[] }`. Whole-item last-write-wins means two people reacting
  to the same comment at the same instant can drop one; fine for now, worth a per-field
  merge on the real backend.
- **2026-11-03: Columns → sections (grid).** The vertical/horizontal switch is gone;
  a section has `cols` (1 = a plain column) and fills left to right, wrapping, each
  row as tall as its tallest item. Cells are one card wide, or as wide as the widest
  nested section. Drag the right edge to change the count, or use the toolbar's
  Columns picker. Data v5: vertical → 1, horizontal → one column per item. Code
  still calls the kind `column`; only the UI says "section".
- **2026-11-04: Frames group loosely.** A `frame` item is just a titled, tinted rect
  (x, y, w, h) drawn behind everything (bigger frames further back). Nothing is stored
  inside it: dragging one carries whatever sits *wholly* within its bounds at grab time,
  so things move in and out by being dragged in and out. Box selection only picks a frame
  if the box encloses it, so selecting within one picks its contents. Deleting a frame
  leaves its contents. Arrange (align / spread / grid) never stacks things on top of
  each other: aligning on a vertical line also makes a column, on a horizontal line a row.
  Frames are square-cornered and resize from the bottom-right corner only.
- **2026-11-04: Admin file manager** (`#/admin`, opened by clicking the logo 5 times
  quickly; `src/ui/AdminPage.tsx`, API in `server/admin.ts`). Lists every uploaded file with
  who uploaded it and when, its size (plus posters / proxy), and every card and version using
  it, by board; filter by board or "not on any board", search, sort, preview, open, download,
  delete (single or bulk). Deleting takes the file off the boards too: an older version is
  dropped, a current version falls back to the one before, a card with nothing left is
  deleted with its comments. Uploads now write `<id>.meta.json` (uploader, time, original
  name; never served). Older files have no uploader on record: the board owner is shown,
  marked as a guess. Protected by a key checked server-side (`x-admin-key`, 10 wrong tries
  per minute per address): `ADMIN_KEY` env var (Render generates one, see its Environment
  tab), else one generated once, kept in `server-db.json` and printed at startup.
- **2026-11-04: Unused uploads clear themselves** (`server/admin.ts`, sweep every minute).
  A file no item refers to (any `/uploads/<id>.` string anywhere in any item, so versions,
  previews and future uses count) gets a clock, saved in `uploads/.orphans.json`; after
  `ORPHAN_GRACE_MINUTES` (10) unused, and at least that old as a file, it's deleted with its
  posters / proxy / record. Back on a board resets it. Posters etc. whose file is gone are
  cleared too. Nothing is swept while the server holds no media cards at all (looks wiped,
  or browsers haven't re-sent their boards yet). The admin page shows when each unused file
  goes and has "Clear unused now" (skips the wait, not uploads from the last 2 minutes).
- **2026-11-04: Videos are kept on the device.** `src/lib/mediaCache.ts` downloads a whole
  video once into Cache Storage (4 at a time, with progress; files over 400 MB just stream;
  least recently used dropped past 3 GB) and players get a disk-backed blob: URL for the saved
  copy, so playing and seeking need no network and reopening is instant. Side by side
  streams by default (starts once every tile has ~2.5s buffered; the clock waits if one runs
  dry), with a "Download first" switch (remembered) that fetches every tile whole this way
  first; either way it won't play until all can (ring loader, one segment per video), and
  saved copies are always used. Nothing is downloaded in full unless you ask (the full player
  no longer saves in the background: it doubled first-view bandwidth). Cards and players use
  a saved copy when there is one. A service
  worker (`public/sw.js`) caches posters, filmstrips and photos only: Chrome refuses video a
  service worker returns as synthesised 206 ranges ("format error"), so it never touches video.
  Needs https or localhost (not plain-http LAN addresses, where it does nothing).
- **2026-11-04: Jumps line everyone up.** In Side by side, starting, any jump, a video >0.35s
  off, or one out of data stops the clock, pauses and seeks every video to the same frame, and
  restarts them all together once each has landed with data. Seeking while the clock ran on
  was a chase (slow seekers landed late, were off again, re-seeked, never caught up). How long
  a jump takes then depends on keyframe spacing, so videos with keyframes >2s apart (first
  minute, read with ffprobe) get a 720p proxy, and proxies have a keyframe every second: in
  testing, the same footage went from 1–8s per jump to under 0.15s.
- **2026-11-04: Toolbar hierarchy** (`itemActions` in `src/ui/panels.tsx`). Every toolbar is
  the same groups in the same order, a divider between them: **primary** (first, accent icon;
  button with a word: Open for boards and links, Play / View for videos and images, Play N
  for a selection) · **review** (comment) · **look** (colour, text, strip, icon) ·
  **organise** (rename, edit link, sort, columns, loop; frame / section for a selection) ·
  **file** (download) · **danger** (delete, last, neutral until hovered). A selection's
  toolbar starts "N selected"; the arrange strip stays to its right. Toolbar icons share one stroke
  (2). A media card's review status lives on the card, not the toolbar: at rest a
  4px strip in its colour along the top; on hover, its tag in the top-left corner (click to
  change; a "Status" button there when unset).
- **2026-11-04: Downloads** (`src/board/download.ts`, panel `src/ui/Downloads.tsx`). Download
  sits left of Delete on a photo/video's toolbar and on a multi-selection's (the photos and
  videos in it, sections' contents included). Files are fetched by the page (2 at a time,
  the rest queued; a copy kept on the device is used if there is one) so each gets a
  progress bar in the bottom-right panel, then saved via an <a download> under the card's
  name with the file's extension. Cancel / retry per file; the panel closes itself 4s after
  everything's saved. (`/uploads/…?dl=<name>` also serves a file as a named attachment.)
- **2026-11-04: Pasting from elsewhere** (`src/board/pasteText.ts`). Files → photo/video cards
  (as before); a web address (one per line, up to 12) → link cards; other text → a note.
  A Pinterest link (pinterest.* or pin.it) → the pin itself via `server/pinterest.ts`: the
  pin-info endpoint Pinterest's embed widgets use gives its 720p MP4 (video), original GIF, or
  original image, fetched through the server (only *.pinimg.com) and added like an upload;
  if that fails it stays a link. Pins come in collapsed (no name strip); video pins loop.
  Any video card has a Loop toggle (toolbar): plays on its own, muted, on a loop, only while
  on screen (IntersectionObserver), with a small loop badge on the card. Our own Ctrl+C also writes the cards' text to the system
  clipboard and remembers it, so pasting that text back gives the cards, not a note. Pastes
  land under the pointer (else mid-view), stepping along when repeated.
- **2026-11-04: One tooltip style** (`src/ui/Tooltip.tsx`, mounted once). Every `title`
  becomes it on first hover (moved to `data-tip`); `data-tip` works directly; new lines make
  more lines (first one brighter). Text cut off with an ellipsis shows whole on hover. Cards
  record `createdBy` / `createdAt` (older ones don't have them); media captions, board tiles,
  links and section titles show full name, details and "Added by Name • Nov 4, 2026 at 1:22 PM"
  (`src/board/details.ts`, `src/lib/time.ts`); comment times, versions and notifications show
  full dates.
- **2026-11-04: Side by side plays up to 25 (5×5) on one clock.** `src/ui/MediaWall.tsx`.
  The time belongs to a master clock, not to any one video; videos follow by nudging
  their playback rate (±8%) and only seek when >0.35s off, because 25 simultaneous seeks
  is what stutters. Scrubbing coalesces seeks (each video re-seeks to the latest time once
  its last seek lands). If a video runs out of data the clock waits and the rest pause.
  Only one tile has sound. The timeline is the longest video; shorter ones hold their last
  frame. 25 is the cap because browsers start falling back to software decoding past
  ~16–32 simultaneous hardware decoders, and at 5×5 tiles are already ~300px wide.

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
  GIFs loop on their own. Double-click, Enter or the ⤢ in the card's bottom-right corner
  opens the full-size player: Space play-pause, J/K/L shuttle (again for faster), ←/→ 5s,
  , and . one frame, [ and ] previous / next comment, Enter comment on this frame, I / O
  (or Shift-drag the timeline) a range, M mute, C show/hide comments, Esc close; full
  screen only from its button. The pen in the comment box draws on the frame (pen, arrow,
  box; Ctrl+Z undo); clicking such a comment later shows the drawing. Drag a video onto
  another to add it as the next version; the player's "v3 ▾" switches version and Compare
  sets two side by side. Click the time
  readout to switch to frame numbers; speed menu 0.25×–2×; , and . also step a selected card's video (assumes 24 fps until the backend reads the real rate)
- Comments: the toolbar's comment button opens a comment box beside the item; once it has
  comments, a panel beside it shows up to 5 whenever it's selected (Enter posts, Shift+Enter new line; "Show N more").
  Each comment has react, and on your own edit / delete; click a reaction chip to add or take back yours. On a video the comment is pinned to the card's current time
  (click the time chip for a whole-video comment); click a timecode to jump there. The
  player (a review window like Frame.io: picture ~70% wide, timeline with avatar markers,
  HH:MM:SS:FF timecode, ‹ n of m › through the board's media) lists every comment, numbered. Reply under any
  comment; type @ to mention someone who can see the board (↑/↓, Enter). The bell (top
  right) lists mentions and replies; clicking one opens the board and selects the item
- Sections: S (or C); double-click header to rename; double-click body to add a note;
  Sort (toolbar) puts the cards in name order, A to Z or Z to A (natural: clip 2 before clip 10;
  ignores case and accents; unnamed cards last), once — drag to reorder after;
  drag the right edge to change the number of grid columns
- Frames: select several things → Wrap in a frame (Ctrl/⌘+G); click a selected frame's tag
  to rename; drag its background to move it with what's inside; drag its bottom-right corner to resize.
  The strip beside a multi-selection lines things up, spaces them out or tidies them into a
  grid (hover a button to preview)
- Others' selections: what anyone else on the board has selected gets an outline in their
  cursor colour with their avatar on its top-right corner (several people stack there).
  Sent with presence, only when it changes, not with every cursor move
- Selecting: click; Ctrl/⌘-click adds or removes; Shift-click adds or removes on the
  canvas, but inside a section selects the run from the last card you picked (like a file
  list). Drag on empty canvas to box-select (Shift adds); Shift-drag inside a section or
  frame boxes what's inside it instead of moving it (Ctrl/⌘+Shift keeps the selection).
  Ctrl/⌘+A selects the section you're in, again for the whole board. Arrows: in a section
  move to the next card (↑/↓ a row, Shift extends); elsewhere nudge a grid step (Shift ×4;
  1px / 10px with snapping off) — a frame brings its contents. The right-click menu also
  has Play together and Wrap in a frame
- Side by side: select several photos / videos → Play together (group toolbar) or Enter.
  Up to 25 in a grid on one timeline (Space, K, ←/→ 5s, , and . a frame, Home, M sound,
  Esc close); a tile's speaker picks whose sound you hear; double-click a tile to open it
  in the full player at the same moment (Esc comes back)
- Sidebar Add buttons: click to add at centre, or drag the button out — a preview tile
  follows the cursor and becomes a real item once it clears the sidebar
- Drag and flick to throw; Delete removes; G toggles snap, hold Alt to place freely
- Boards: B, or drag from the sidebar; double-click / Enter to open; Alt+↑ goes up a level;
  click the centred board name for its settings
- Copy / cut / paste / duplicate: Ctrl/⌘ + C / X / V / D (right-click → Paste here)
- Move into another board: drag onto a board tile, or onto a board in the top-bar path
- Zoom to fit: Shift+1
