# Heist Workspace

A lightweight infinite canvas for organising and reviewing work together: notes,
links, to-do lists, columns and nested boards, with live cursors and shared
editing. Built with React, TypeScript and Vite.

> **Status: early testing build.** There are no logins — anyone with the link
> can get in (see [Testing identity](#testing-identity)) — and sync is "last
> edit wins" per item. Don't put anything sensitive in it yet.

## Run it

Requires [Node.js](https://nodejs.org) 22.18 or newer.

```sh
npm install
npm run dev        # http://localhost:5173 — sync + link previews included
```

### Test with people on your network

The sync server runs on one machine; everyone else just opens its address.

```sh
npm run dev:lan    # dev server, reachable from the network (port 5173)
# or, for a production build on port 8080:
npm run lan        # = npm run build && npm run serve
```

The server prints the network address to share (e.g. `http://10.0.0.12:8080`).
Windows may ask to allow Node.js through the firewall the first time; allow it
on private networks. Everyone's boards are saved on that machine in
`data/server-db.json` (not committed).

### Host it online (Render, free)

The repo includes a [Render Blueprint](render.yaml): one free web service that
builds the app and runs `server/index.ts` (app + sync + link previews).

1. Push this repo to GitHub.
2. On [render.com](https://render.com), sign in with GitHub → **New** → **Blueprint** →
   pick the repo → **Apply**.
3. Share the `https://heist-workspace-….onrender.com` address it gives you.

Every push to `main` redeploys. The free tier sleeps after ~15 minutes idle (the
first visit then takes ~30 s) and its disk is wiped on restart; browsers
re-upload their own boards and names when they reconnect, so nothing is lost
as long as someone still has it in their browser.

## Using it

- **Add things** from the left bar: click, or drag a tile onto the canvas. Keys: N note,
  L link, T to-do, B board, C column.
- **Select** by clicking, Shift-clicking, or dragging a box on empty canvas. Right-click for
  actions; Ctrl/⌘ + C / X / V / D to copy, cut, paste, duplicate.
- **Pan** with the scroll wheel / trackpad, Space + drag, or middle-drag. Zoom with
  Ctrl/⌘ + scroll or pinch.
- **Boards:** open by clicking a selected board again. Drag things onto a board (or onto a
  board in the path at the top) to move them into it.
- **Share** a board from the top right; boards shared with you appear under the people icon.
- **Cursor chat:** press `/` and type — others see it beside your cursor. Esc clears it.

## Testing identity

There are no logins yet. Each browser keeps a random anonymous id, and the
server derives your user id from it — so each browser is one person, and you
stay the same person across visits. (An IP address isn't enough once it's
online: everyone in one office shares a public address.) To be several people
from one browser while testing, add `?as=<anything>` to the URL, e.g.
`http://localhost:5173/?as=second`.

## Project notes

Design rules, roadmap and decisions live in [PROJECT.md](PROJECT.md).
