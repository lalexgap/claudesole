# Claudesole — Codebase Guide

## Architecture

```
electron/          Main process (Node.js)
  main.ts          BrowserWindow, IPC handlers, keyboard shortcuts
  preload.ts       contextBridge — exposes electronAPI to renderer
  ptyManager.ts    node-pty session lifecycle (create/write/resize/kill)
  sessionManager.ts Reads ~/.claude/projects/**/*.jsonl for history

src/               Renderer process (React + TypeScript)
  App.tsx          Root component — state, handlers, layout
  store/
    sessions.ts    Zustand store — tabs, status, pin, rename
  hooks/
    useTerminal.ts xterm.js setup, FitAddon, SearchAddon, idle detection
  components/
    TabBar.tsx         Top bar with tabs + buttons
    Tab.tsx            Single tab — rename, pin, context menu, fork
    TerminalView.tsx   xterm container + search overlay
    NewSessionModal.tsx  Session picker (⌘T)
    SessionHistoryPanel.tsx  Full history view (⌘H)
    SessionSidebar.tsx  Running sessions sidebar (⌘B)
  types/
    ipc.ts         ElectronAPI interface + ClaudeSession type

build/             App icon assets
scripts/
  make-icon.sh     Converts build/icon.svg → build/icon.icns
```

## Key patterns

### IPC flow
Renderer calls `window.electronAPI.<method>()` (defined in preload.ts via contextBridge).
Main process handles via `ipcMain.on` / `ipcMain.handle`.

### PTY lifecycle
Each tab has a unique `sessionId` (nanoid). The PTY is spawned in `ptyManager.createSession()`.
Data flows: PTY → `pty:data` IPC → renderer `onData` listener → `term.write()`.

### Claude CLI flags used
- `--resume <uuid>` — resume a specific session
- `--fork-session` — fork conversation history (used with --resume)
- `--dangerously-skip-permissions` — skip tool approval prompts
- `--worktree` — run in a git worktree

### Session history
Claude stores sessions at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`.
`sessionManager.ts` reads the head (16KB) for cwd/slug/firstPrompt and does a reverse-chunk scan from the tail for the latest user message.

### Idle detection / notifications
`useTerminal.ts` tracks whether incoming PTY data is a Claude response or a user-keystroke echo using a 150ms suppression window set when `term.onData` fires. Notifications only fire when `claudeRespondedRef` is true (i.e. Claude actually sent data in the current cycle).

## Build

```bash
npm install          # also runs electron-rebuild for node-pty
npm run dev          # dev server + Electron
npm run make-icon    # SVG → ICNS (requires sips + iconutil, macOS only)
npm run dist         # production DMG via electron-builder
```

## Common pitfalls

- **node-pty must be rebuilt** for each Electron version — handled by `postinstall` script.
- **renderer root** must be set to the project root in `electron.vite.config.ts` (not `src/renderer/`).
- **xterm package**: use `@xterm/xterm`, not the deprecated `xterm` package — they use different module namespaces and addons are not cross-compatible.
- **asar + node-pty**: native modules can't run inside an asar archive — `asarUnpack` is set in package.json build config.
