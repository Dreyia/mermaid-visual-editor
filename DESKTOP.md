# Desktop build (Electron)

Wraps the existing Next.js static export (`output: 'export'` -> `out/`) in an Electron
shell. Added on top of upstream commit `e5fba95`.

## Files added

| Path | Purpose |
|---|---|
| `electron/main.js` | Main process. Registers an `app://` scheme and serves `out/` from disk. |
| `electron/preload.js` | Minimal, context-isolated preload; exposes `window.desktop`. |
| `electron-builder.yml` | Packaging config (NSIS installer + portable exe). |
| `build/icon.ico` | App icon, 256x256. |
| `lib/theme.ts` | Light/dark/system preference store. |
| `components/ThemeToggle.tsx` | Appearance control (Settings popover). |

Why `app://` instead of the bundled `serve` on localhost (what `bin/cli.js` does):
no port conflicts, no listening socket, works fully offline, and the scheme is
registered as `standard` + `secure` so `navigator.clipboard.writeText()` (used by
TopToolbar and the command palette) still works.

## Scripts

```bash
pnpm desktop      # next build && electron .    <- normal dev loop
pnpm desktop:run  # electron .                  <- reuse the existing out/
pnpm dist         # next build && electron-builder --win
pnpm dist:dir     # unpacked build only, no installer
```

Output lands in `dist/`:

- `MermaidVisualEditor-0.1.0-setup.exe` - NSIS installer (choose install dir, desktop + start menu shortcuts)
- `MermaidVisualEditor-0.1.0-portable.exe` - single-file portable
- `dist/win-unpacked/Mermaid Visual Editor.exe` - unpacked

Both exes are unsigned, so SmartScreen shows "Windows protected your PC" on first
run -> More info -> Run anyway.

## Theming

Flat/minimal replacement for the original neumorphic look, with light and dark
palettes. Semantic tokens live in `app/globals.css`; the legacy `--neu-shadow-*`
variables were re-pointed at flat hairlines rather than deleted, so all ~40 inline
`boxShadow: 'var(--neu-shadow-raised)'` usages pick up the new look untouched.

Theme resolution: a blocking script in `app/layout.tsx` stamps
`data-theme="light|dark"` on `<html>` before first paint (no flash). Preference is
stored in `localStorage` under `mve-theme`. `System` follows `prefers-color-scheme`
and reacts live to OS changes.

Deliberate exception: the diagram-rendering surfaces (`--paper`) stay white in both
themes, and node fill/stroke/text defaults are unchanged. Those are diagram *content*
- they are serialised into the `.mmd` - so tinting them would make the preview stop
matching the exported file.

## Manual test steps

### A. Launch
1. `pnpm desktop:run` (or run `dist/MermaidVisualEditor-0.1.0-portable.exe`).
2. Window opens titled "Mermaid Visual Editor", ~1440x900, no white flash on startup.
3. Menu bar shows File / Edit / View / Help. Help -> About shows Electron + Chromium versions.

### B. Theme
4. Gear icon (far right of the top toolbar) -> Settings popover -> APPEARANCE.
5. Click **Dark**. Whole UI switches immediately: canvas, toolbar, inspector, popover.
6. Click **Light**. Switches back.
7. Click **System**. UI matches the Windows app theme (Settings -> Personalisation -> Colours).
8. With **System** selected, flip Windows between light and dark -> app follows without a restart.
9. Close the app and reopen -> the last choice is remembered. There should be no
   flash of the wrong theme during startup.

### C. Core editing (regression - none of this was touched, verify it still works)
10. Press `N` (or double-click the canvas) -> a node appears.
11. Drag from a node handle to another node -> an edge is created.
12. Double-click a node label -> inline edit -> type -> Enter.
13. Select a node -> Inspector -> OBJECT SETTINGS -> change fill/stroke/text colour.
14. `Ctrl+Z` / `Ctrl+Shift+Z` -> undo/redo.
15. `Ctrl+K` -> command palette opens, arrow keys move the highlight, Esc closes.
16. Auto Layout button (top right of the Inspector) -> nodes reflow.

### D. Mermaid output
17. MERMAID LIVE section renders the diagram and shows the syntax below it.
18. In dark mode the diagram sits on a white card - expected, see "Theming" above.
19. Click the expand arrow -> full-size preview modal -> Esc closes.
20. **Copy** -> paste into a text editor -> matches the syntax block.
    (This is the clipboard check - it proves the `app://` secure-context setup works.)
21. Diagram Settings -> Theme -> `Dark` -> the rendered diagram itself goes dark
    (this is Mermaid's own theme, independent of the app theme).

### E. File I/O
22. Settings -> **Save JSON** -> Windows save dialog appears -> save `diagram.json`.
23. Settings -> **Load JSON** -> pick that file -> the diagram comes back.
24. Settings -> **Download .mmd** and **Export SVG** -> both produce files.
25. Settings -> **Import .mmd** -> paste a flowchart -> live parse count appears in
    green -> **Import to Canvas** loads it.

### F. Window / shell behaviour
26. Launch a second instance -> the existing window focuses instead of opening a new one.
27. Help -> Project on GitHub -> opens in the default browser, not inside the app window.
28. Resize below 960x640 -> the window stops shrinking.
29. View -> Toggle Developer Tools -> console shows no errors.

### F2. Keyboard ownership (the bugs fixed in this fork)
30. Settings → **Import .mmd** → click in the textarea → **Ctrl+V**. Clipboard text
    lands in the box (previously nothing happened).
31. Type something in that box, press **Ctrl+Z** → the *typing* is undone, not the diagram.
32. Press **Escape** → the import dialog closes. Escape again → the settings popover closes.
33. **Ctrl+K** while the caret is in a text field → nothing happens. Click empty canvas,
    **Ctrl+K** again → the command palette opens; Escape closes it.
34. Double-click an empty patch of canvas → a node appears there.
35. Import `flowchart TD` + `A["a"] --> |"yes"| B["b"]` (note the space before the pipe)
    → the status line reads *2 nodes, 1 edge*, and both nodes plus the edge land on the canvas.

### G. Packaging
36. Run the installer, pick a directory, finish.
37. Desktop and Start Menu shortcuts exist and carry the flowchart icon.
38. Launch from the shortcut -> same behaviour as steps A-F2.
39. Uninstall via Settings -> Apps -> the app is removed.

## Upstream bugs fixed here

All five predate this fork and affect the web app too. Each was reproduced with a
scripted browser before and after the change.

| Bug | Cause |
|---|---|
| **Escape closed nothing** — settings popover, shape picker, command palette, expanded preview, import dialog | `Canvas.tsx` cleared its draw-mode state on *every* Escape, even when nothing was being drawn. keydown is a discrete event, so React flushed that re-render synchronously **during dispatch**, which unregistered and re-registered every window `keydown` listener belonging to a component further down the tree. Per the DOM spec a listener added mid-dispatch is skipped for that event, so every other Escape handler was silently passed over. Now the state is only written when there is something to cancel. |
| **Ctrl+V did nothing in a text field** — reported as "can't paste into the import box" | `Canvas.tsx` computed `isTyping` but only applied it to the `N` shortcut. `Ctrl+V/C/Z/Y/D/K` all ran `preventDefault()` unconditionally, so in any input the canvas stole paste, copy, undo, redo, duplicate and the command palette. Now every shortcut below Escape bails out when the caret is in an `input`, `textarea` or `contenteditable`. |
| **Import .mmd closed on any click inside it** | `ImportModal` is a *sibling* of the settings popover, so clicks in it counted as "outside" and tore the popover down, unmounting the modal. The Escape handler already guarded on `importOpen`; the mousedown one now does too. |
| **Double-click on empty canvas added nothing**, despite the empty-state text saying it would | React Flow binds d3-zoom's double-click-to-zoom, which calls `stopImmediatePropagation()`. Set `zoomOnDoubleClick={false}`. |
| **`A --> |label| B` silently dropped the edge** and any node introduced on its right-hand side | The parser's label regex required the pipe to touch the arrow. Mermaid itself accepts a space there, so importing valid `.mmd` lost data with no warning. |

Shortcut key comparisons are also case-insensitive now, so they still work with Caps
Lock on.

---

## Automated audit

`tests/ui-audit.mjs` drives the built export in a real browser and asserts 64 things
across keyboard ownership, Escape handling, import/parse round-trips, edge creation,
the inspector, theming, the command palette and file I/O.

```bash
pnpm build
npx serve out -l 8899
node tests/ui-audit.mjs            # exits non-zero on any failure
```

It needs Playwright (`pnpm dlx playwright install chromium` once) but is deliberately
not a project dependency — it is a maintenance tool, not part of the build. `BASE=`
and `CHROMIUM=` override the URL and browser binary.

---

## Known / not addressed

- The Inspector renders section titles twice ("OBJECT SETTINGS" / "DIAGRAM SETTINGS"
  as both the collapsible header and an inner heading). Pre-existing upstream, left alone.
- Two different controls are labelled "Dark" (the app appearance toggle and the Mermaid
  diagram theme dropdown), which is confusing in a narrow inspector.
- The exes are unsigned; signing needs a code-signing certificate.
- `next.config.ts` `headers()` does not apply to a static export. `electron/main.js`
  sets `x-content-type-options` and `referrer-policy` on the `app://` responses instead.
