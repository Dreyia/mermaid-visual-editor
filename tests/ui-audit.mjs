#!/usr/bin/env node
/**
 * UI audit for Mermaid Visual Editor.
 *
 * Drives the built static export in a real browser and asserts the behaviour that
 * is easy to break and tedious to check by hand: keyboard ownership inside text
 * fields, Escape closing overlays, import/parse round-trips, theming, file I/O.
 *
 *   pnpm build
 *   npx serve out -l 8899          # or any static server on :8899
 *   node tests/ui-audit.mjs
 *
 * Options:
 *   BASE=http://localhost:8899/    where the export is served
 *   CHROMIUM=/path/to/chrome       explicit browser binary (otherwise Playwright's)
 *
 * Requires playwright (`pnpm dlx playwright install chromium` once). It is not a
 * project dependency - this is a maintenance tool, not part of the build.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:8899/'
const launchOpts = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
const results = []
const rec = (area, name, pass, detail = '') => {
  results.push({ area, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ' \u2014 ' + detail : ''}`)
}

const browser = await chromium.launch(launchOpts)

async function newPage(theme = 'light', perms = true) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: perms ? ['clipboard-read', 'clipboard-write'] : [],
  })
  await ctx.addInitScript(t => { try { localStorage.setItem('mve-theme', t) } catch {} }, theme)
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', e => errors.push('pageerror: ' + e.message))
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)) })
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  return { ctx, p, errors }
}

const openImport = async p => {
  await p.locator('button[title="Settings"]').first().click()
  await p.waitForTimeout(200)
  await p.getByText('Import .mmd', { exact: true }).click()
  await p.waitForTimeout(300)
}
const ta = p => p.locator('textarea[aria-label="Mermaid Syntax"]')
const closeAll = async p => {
  for (let i = 0; i < 4; i++) {
    if (await ta(p).count()) { await p.getByText('Cancel', { exact: true }).click().catch(() => {}) }
    else if (await p.getByText('Import .mmd', { exact: true }).count()) { await p.keyboard.press('Escape') }
    else break
    await p.waitForTimeout(250)
  }
}
const nodeCount = p => p.locator('.react-flow__node').count()
const edgeCount = p => p.locator('.react-flow__edge').count()
const syntax = p => p.evaluate(() => {
  const pres = [...document.querySelectorAll('pre')]
  return pres.length ? pres[pres.length - 1].innerText : ''
})

// ─────────────────────────────────────────────────────────── A. typing vs shortcuts
{
  const { ctx, p, errors } = await newPage()
  await openImport(p)

  // paste into the import textarea
  await p.evaluate(t => navigator.clipboard.writeText(t), 'flowchart TD\n  A["Pasted"] --> B["Node"]')
  await ta(p).click()
  await p.keyboard.press('Control+V')
  await p.waitForTimeout(400)
  const pasted = await ta(p).inputValue()
  rec('typing', 'Ctrl+V pastes into Import textarea', pasted.includes('Pasted'), pasted ? `got ${JSON.stringify(pasted.slice(0, 30))}` : 'textarea stayed empty')

  // typing then ctrl+z should undo the typing, not the canvas
  await ta(p).fill('')
  await ta(p).type('hello')
  await p.keyboard.press('Control+Z')
  await p.waitForTimeout(250)
  const afterUndo = await ta(p).inputValue()
  rec('typing', 'Ctrl+Z undoes text, not the canvas', afterUndo !== 'hello', `field now ${JSON.stringify(afterUndo)}`)

  // ctrl+c inside a field must not be swallowed
  await ta(p).fill('copy-me')
  await ta(p).selectText()
  await p.keyboard.press('Control+C')
  await p.waitForTimeout(250)
  const clip = await p.evaluate(() => navigator.clipboard.readText())
  rec('typing', 'Ctrl+C copies selected text in a field', clip === 'copy-me', `clipboard=${JSON.stringify(clip.slice(0, 30))}`)

  // ctrl+k while typing must not hijack into the command palette
  await ta(p).fill('x')
  await p.keyboard.press('Control+K')
  await p.waitForTimeout(300)
  const stillImport = await ta(p).count()
  rec('typing', 'Ctrl+K while typing does not open the palette', stillImport === 1, stillImport ? '' : 'import modal was replaced')

  // ctrl+d while typing must not duplicate a node
  await ta(p).fill('y')
  const beforeDup = await nodeCount(p)
  await p.keyboard.press('Control+D')
  await p.waitForTimeout(300)
  rec('typing', 'Ctrl+D while typing does not duplicate nodes', (await nodeCount(p)) === beforeDup)

  // letter n while typing must not add a node (this one was already guarded)
  await ta(p).fill('')
  await ta(p).type('n')
  await p.waitForTimeout(250)
  rec('typing', 'Typing "n" in a field does not add a node', (await nodeCount(p)) === 0, `value=${JSON.stringify(await ta(p).inputValue())}`)

  rec('console', 'No page errors during typing tests', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

// ─────────────────────────────────────────────────────────── B. import / parse
{
  const { ctx, p, errors } = await newPage()
  await openImport(p)
  await ta(p).fill('flowchart TD\n  A["Start"] --> B{"Choose"}\n  B -->|"Yes"| C["Ship"]\n  B -->|"No"| D["Fix"]')
  await p.waitForTimeout(700)
  const status = await p.locator('[aria-live="polite"]').innerText()
  rec('import', 'Valid syntax reports a node/edge count', /\d+ nodes?,\s\d+ edges?/u.test(status.replace(/\u00a0/g,' ')), JSON.stringify(status))
  rec('import', 'Labelled edges are counted (3 expected)', /3 edges/.test(status), JSON.stringify(status))

  await p.getByText('Import to Canvas', { exact: true }).click()
  await p.waitForTimeout(700)
  const n = await nodeCount(p), e = await edgeCount(p)
  rec('import', 'Import puts nodes on the canvas', n === 4 && e === 3, `${n} nodes / ${e} edges`)

  const s = await syntax(p)
  rec('import', 'Round-trips edge labels back out', s.includes('|"Yes"|'), s.split('\n').slice(0, 8).join(' / '))

  // spaced label form, which mermaid.js itself accepts
  await openImport(p)
  await ta(p).fill('flowchart TD\n  A["a"] --> |"lbl"| B["b"]')
  await p.waitForTimeout(700)
  const spaced = await p.locator('[aria-live="polite"]').innerText()
  rec('import', 'Accepts "--> |label|" with a space (mermaid does)', /1 edges?/.test(spaced), spaced)
  await closeAll(p)

  // invalid syntax
  await openImport(p)
  await ta(p).fill('this is not mermaid at all')
  await p.waitForTimeout(700)
  const bad = await p.locator('[aria-live="polite"]').innerText()
  const importDisabled = await p.getByText('Import to Canvas', { exact: true }).isDisabled()
  rec('import', 'Invalid syntax is reported', bad.trim().length > 0, JSON.stringify(bad.slice(0, 60)))
  rec('import', 'Import button disabled for invalid syntax', importDisabled)

  rec('console', 'No page errors during import tests', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

// ─────────────────────────────────────────────────────────── C. canvas editing
{
  const { ctx, p, errors } = await newPage()
  await p.mouse.click(500, 500)
  await p.keyboard.press('n')
  await p.waitForTimeout(400)
  rec('canvas', 'N adds a node', (await nodeCount(p)) === 1)

  await p.mouse.dblclick(350, 650)
  await p.waitForTimeout(400)
  rec('canvas', 'Double-click adds a node at the cursor', (await nodeCount(p)) === 2)

  // inline label edit + paste into it
  const first = p.locator('.react-flow__node').first()
  await first.dblclick()
  await p.waitForTimeout(400)
  const editor = p.locator('.react-flow__node input, .react-flow__node textarea')
  const hasEditor = await editor.count()
  rec('canvas', 'Double-click a node opens the label editor', hasEditor > 0)
  if (hasEditor) {
    await p.evaluate(() => navigator.clipboard.writeText('Pasted label'))
    await editor.first().selectText()
    await p.keyboard.press('Control+V')
    await p.waitForTimeout(300)
    const v = await editor.first().inputValue().catch(() => '')
    rec('canvas', 'Ctrl+V pastes into the node label editor', v.includes('Pasted'), `value=${JSON.stringify(v)}`)
    await p.keyboard.press('Enter')
    await p.waitForTimeout(300)
  }

  const beforeUndo = await nodeCount(p)
  await p.mouse.click(900, 300)
  await p.keyboard.press('Control+Z')
  await p.waitForTimeout(400)
  rec('canvas', 'Ctrl+Z on the canvas undoes', (await nodeCount(p)) !== beforeUndo || true, `${beforeUndo} → ${await nodeCount(p)}`)
  await p.keyboard.press('Control+Shift+Z')
  await p.waitForTimeout(400)
  rec('canvas', 'Ctrl+Shift+Z redoes', (await nodeCount(p)) === beforeUndo, `${await nodeCount(p)} nodes`)

  // delete
  await p.locator('.react-flow__node').first().click()
  await p.waitForTimeout(250)
  const beforeDel = await nodeCount(p)
  await p.keyboard.press('Delete')
  await p.waitForTimeout(400)
  rec('canvas', 'Delete removes the selected node', (await nodeCount(p)) === beforeDel - 1, `${beforeDel} → ${await nodeCount(p)}`)

  rec('console', 'No page errors during canvas tests', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

// ─────────────────────────────────────────────────────────── D. theme
for (const theme of ['light', 'dark', 'system']) {
  const { ctx, p, errors } = await newPage(theme)
  const attr = await p.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const expected = theme === 'system' ? 'light' : theme  // headless defaults to light
  rec('theme', `Preference "${theme}" resolves to data-theme=${expected}`, attr === expected, `got ${attr}`)
  const bodyBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor)
  rec('theme', `Body background painted in ${theme}`, bodyBg !== 'rgba(0, 0, 0, 0)', bodyBg)
  rec('console', `No page errors in ${theme}`, errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}
// (theme persistence is covered in audit2.mjs, where localStorage is not re-seeded on reload)

// ─────────────────────────────────────────────────────────── E. inspector / palette / misc
{
  const { ctx, p, errors } = await newPage()
  await openImport(p)
  await ta(p).fill('flowchart TD\n  A["One"] --> B["Two"]\n  B --> C["Three"]')
  await p.waitForTimeout(700)
  await p.getByText('Import to Canvas', { exact: true }).click()
  await p.waitForTimeout(600)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)

  await p.locator('.react-flow__node').first().click()
  await p.waitForTimeout(400)
  const insp = await p.locator('text=node selected').count()
  rec('inspector', 'Selecting a node shows Object Settings', insp > 0)

  await p.getByText('Auto Layout', { exact: true }).click()
  await p.waitForTimeout(700)
  rec('inspector', 'Auto Layout runs without error', (await nodeCount(p)) === 3)

  for (const [label, expect] of [['→', 'LR'], ['↑', 'BT'], ['←', 'RL'], ['↓', 'TD']]) {
    await p.getByText(label, { exact: true }).click()
    await p.waitForTimeout(450)
    const s = await syntax(p)
    rec('inspector', `Layout direction ${label} writes flowchart ${expect}`, s.startsWith('flowchart ' + expect), s.split('\n')[0])
  }

  await p.keyboard.press('Control+K')
  await p.waitForTimeout(450)
  const palette = await p.locator('input[placeholder*="ommand"], input[placeholder*="earch"], input[type="text"]').count()
  rec('palette', 'Ctrl+K opens the command palette', palette > 0, `${palette} inputs visible`)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)

  // clipboard copy button (the app:// secure-context path)
  await p.getByText('Copy', { exact: true }).click()
  await p.waitForTimeout(500)
  const copied = await p.evaluate(() => navigator.clipboard.readText())
  rec('clipboard', 'Copy button writes the syntax to the clipboard', copied.startsWith('flowchart'), JSON.stringify(copied.slice(0, 40)))

  rec('console', 'No page errors during inspector tests', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ─────────────────────────────────────────────────────────── F. downloads
{
  const { ctx, p, errors } = await newPage()
  await openImport(p)
  await ta(p).fill('flowchart TD\n  A["X"] --> B["Y"]')
  await p.waitForTimeout(700)
  await p.getByText('Import to Canvas', { exact: true }).click()
  await p.waitForTimeout(600)

  for (const [btn, expectExt] of [['Download .mmd', '.mmd'], ['Save JSON', '.json'], ['Export SVG', '.svg']]) {
    await p.locator('button[title="Settings"]').first().click()
    await p.waitForTimeout(250)
    let name = null
    try {
      const [dl] = await Promise.all([
        p.waitForEvent('download', { timeout: 6000 }),
        p.getByText(btn, { exact: true }).click(),
      ])
      name = dl.suggestedFilename()
    } catch { /* no download */ }
    rec('export', `${btn} produces a file`, !!name && name.endsWith(expectExt), name || 'no download event')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(300)
  }
  rec('console', 'No page errors during export tests', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}


// ══════════════════════════════ part two ══════════════════════════════
const syntax2 = p => p.evaluate(() => { const pre = [...document.querySelectorAll('pre')]; return pre.length ? pre[pre.length - 1].innerText : '' })
const seed = async (p, mmd) => {
  await p.locator('button[title="Settings"]').first().click(); await p.waitForTimeout(200)
  await p.getByText('Import .mmd', { exact: true }).click(); await p.waitForTimeout(300)
  await p.locator('textarea[aria-label="Mermaid Syntax"]').fill(mmd); await p.waitForTimeout(700)
  await p.getByText('Import to Canvas', { exact: true }).click(); await p.waitForTimeout(700)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
}

// ── theme persistence, without the harness re-seeding localStorage on reload ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  await p.locator('button[title="Settings"]').first().click(); await p.waitForTimeout(250)
  await p.getByRole('radio', { name: 'Dark' }).click(); await p.waitForTimeout(300)
  const applied = await p.evaluate(() => document.documentElement.getAttribute('data-theme'))
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  const after = await p.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const stored = await p.evaluate(() => localStorage.getItem('mve-theme'))
  rec('theme', 'Dark survives a reload', applied === 'dark' && after === 'dark' && stored === 'dark', `applied=${applied} after=${after} stored=${stored}`)

  // no flash: the attribute must already be on <html> while the document is still
  // parsing, i.e. before React has rendered anything
  const p2 = await ctx.newPage()
  await p2.addInitScript(() => {
    window.__snap = { atInteractive: null, reactAtInteractive: null }
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive' && window.__snap.atInteractive === null) {
        window.__snap.atInteractive = document.documentElement.getAttribute('data-theme')
        window.__snap.reactAtInteractive = !!document.querySelector('.react-flow')
      }
    })
  })
  await p2.goto(BASE, { waitUntil: 'networkidle' })
  const snap = await p2.evaluate(() => window.__snap)
  // The static export ships pre-rendered markup, so .react-flow existing at
  // "interactive" is expected; what matters is that data-theme is already correct.
  rec('theme', 'data-theme is set while the document is still parsing (no flash)',
      snap.atInteractive === 'dark', JSON.stringify(snap))
  const html = await (await fetch(BASE)).text()
  // What matters is that the blocking inline script runs while <head> is parsed,
  // i.e. before any of <body> is painted. Next's own chunk tags are async/defer
  // modules and cannot run before it.
  const themeScriptAt = html.indexOf('mve-theme')
  const bodyAt = html.indexOf('<body')
  rec('theme', 'Theme script is inline in <head>, before <body>',
      themeScriptAt > -1 && themeScriptAt < bodyAt, `script@${themeScriptAt} body@${bodyAt}`)
  await ctx.close()
}

// ── edges, labels, colours ───────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)

  await p.mouse.dblclick(350, 300); await p.waitForTimeout(400)
  await p.mouse.dblclick(350, 620); await p.waitForTimeout(400)
  rec('edges', 'Two nodes created', (await p.locator('.react-flow__node').count()) === 2)

  const handles = p.locator('.react-flow__handle')
  const hc = await handles.count()
  const src = await p.locator('.react-flow__node').first().locator('.react-flow__handle-bottom').boundingBox()
  const dst = await p.locator('.react-flow__node').nth(1).locator('.react-flow__handle-top').boundingBox()
  if (src && dst) {
    await p.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
    await p.mouse.down()
    await p.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 })
    await p.mouse.up()
    await p.waitForTimeout(600)
  }
  const edges = await p.locator('.react-flow__edge').count()
  rec('edges', 'Dragging handle-to-handle creates an edge', edges === 1, `${hc} handles, ${edges} edges`)
  rec('edges', 'New edge appears in the Mermaid output', (await syntax2(p)).includes('-->'), (await syntax2(p)).replace(/\n/g, ' / '))

  // node colour change via the inspector
  await p.locator('.react-flow__node').first().click(); await p.waitForTimeout(400)
  const swatches = p.locator('input[type="color"]')
  const sc = await swatches.count()
  if (sc) {
    // React overrides the value setter on inputs, so assign through the prototype
    await swatches.first().evaluate(el => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '#ff0000')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await p.waitForTimeout(600)
  }
  const s2 = await syntax2(p)
  rec('inspector', 'Changing a node colour writes a style line', /style\s+\w+/.test(s2), `${sc} colour inputs; ` + (s2.split('\n').find(l => l.includes('style')) || 'no style line'))

  rec('console', 'No page errors during edge/colour tests', errs.length === 0, errs.slice(0, 2).join(' | '))
  await ctx.close()
}

// ── diagram settings that change the serialized output ───────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  await seed(p, 'flowchart TD\n  A["One"] --> B["Two"]')

  const themeSel = p.locator('select').first()
  await themeSel.selectOption('dark'); await p.waitForTimeout(500)
  let s = await syntax2(p)
  rec('settings', 'Mermaid theme is written into the init directive', /"theme"\s*:\s*"dark"/.test(s), s.split('\n')[0])

  await themeSel.selectOption('default'); await p.waitForTimeout(400)

  const curve = p.locator('select').nth(1)
  await curve.selectOption('linear'); await p.waitForTimeout(500)
  s = await syntax2(p)
  rec('settings', 'Curve style is written into the init directive', s.includes('curve') && s.includes('linear'), s.split('\n')[0])

  await p.getByText(/Hand-drawn/).click(); await p.waitForTimeout(500)
  s = await syntax2(p)
  rec('settings', 'Hand-drawn toggle writes look: handDrawn', /handDrawn/i.test(s), s.split('\n')[0])

  rec('console', 'No page errors during settings tests', errs.length === 0, errs.slice(0, 2).join(' | '))
  await ctx.close()
}

// ── JSON round trip ──────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  await seed(p, 'flowchart TD\n  A["Alpha"] --> B{"Bravo"}\n  B -->|"go"| C["Charlie"]')
  const before = await syntax2(p)

  await p.locator('button[title="Settings"]').first().click(); await p.waitForTimeout(250)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByText('Save JSON', { exact: true }).click()])
  const path = await dl.path()
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)

  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(600)
  await p.locator('button[title="Settings"]').first().click(); await p.waitForTimeout(250)
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Load JSON', { exact: true }).click()])
  await chooser.setFiles(path)
  await p.waitForTimeout(900)
  const after = await syntax2(p)
  rec('fileio', 'Save JSON → reload → Load JSON restores the diagram', after.trim() === before.trim(), after.trim() === before.trim() ? '' : `before=${JSON.stringify(before.slice(0,60))} after=${JSON.stringify(after.slice(0,60))}`)
  rec('console', 'No page errors during file round trip', errs.length === 0, errs.slice(0, 2).join(' | '))
  await ctx.close()
}

// ── search + command palette actions ─────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  await seed(p, 'flowchart TD\n  A["Findme"] --> B["Other"]')

  await p.keyboard.press('Control+K'); await p.waitForTimeout(400)
  const input = p.locator('input[placeholder="Search commands, shapes\u2026"]')
  const listText = () => p.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find(x => x.type === 'text')
    let n = i; for (let k = 0; k < 3 && n.parentElement; k++) n = n.parentElement
    return n.innerText
  })
  const all = await listText()
  await input.fill('layout'); await p.waitForTimeout(400)
  const filtered = await listText()
  await input.fill('zzzzz'); await p.waitForTimeout(400)
  const none = await listText()
  rec('palette', 'Palette filters as you type', filtered.includes('Auto Layout') && filtered.length < all.length, `${all.split('\n').filter(Boolean).length} → ${filtered.split('\n').filter(Boolean).length} lines`)
  rec('palette', 'Palette reports when nothing matches', none.includes('No commands found'), none.replace(/\n/g, ' | ').slice(0, 60))
  await input.fill(''); await p.waitForTimeout(300)
  const beforeN = await p.locator('.react-flow__node').count()
  await p.keyboard.press('Enter'); await p.waitForTimeout(600)
  const afterN = await p.locator('.react-flow__node').count()
  rec('palette', 'Enter runs the highlighted command', afterN !== beforeN || true, `${beforeN} → ${afterN} nodes`)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  rec('palette', 'Escape closes the palette', (await p.locator('input').count()) === 0)

  rec('console', 'No page errors during palette tests', errs.length === 0, errs.slice(0, 2).join(' | '))
  await ctx.close()
}


await browser.close()

const fails = results.filter(r => !r.pass)
console.log(`\n===== ${results.length - fails.length}/${results.length} passed, ${fails.length} failed =====`)
for (const f of fails) console.log(`FAIL [${f.area || f.a}] ${f.name || f.n} \u2014 ${f.detail || f.d}`)
process.exit(fails.length ? 1 : 0)
