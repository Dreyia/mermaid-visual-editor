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

### G. Packaging
30. Run the installer, pick a directory, finish.
31. Desktop and Start Menu shortcuts exist and carry the flowchart icon.
32. Launch from the shortcut -> same behaviour as steps A-F.
33. Uninstall via Settings -> Apps -> the app is removed.

## Known / not addressed

- The Inspector renders section titles twice ("OBJECT SETTINGS" / "DIAGRAM SETTINGS"
  as both the collapsible header and an inner heading). Pre-existing upstream, left alone.
- The exes are unsigned; signing needs a code-signing certificate.
- `next.config.ts` `headers()` does not apply to a static export. `electron/main.js`
  sets `x-content-type-options` and `referrer-policy` on the `app://` responses instead.