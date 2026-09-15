import { chromium } from 'playwright'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const BASE = process.env.DEMO_URL || 'http://localhost:5174'
const round = process.argv.find((arg) => arg.startsWith('--round='))?.split('=')[1] || '3'
const OUT = process.env.SHOT_DIR || `artifacts/round-${round}`
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.setDefaultTimeout(30000)
const errors = []
const checks = []
const failedRequests = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(String(error)))
page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`))
async function open(url) {
  await page.goto(url, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__READY__ === true, null, { polling: 150 })
  await page.locator('.move-grid button').first().waitFor({ state: url.includes('studio=1') ? 'attached' : 'visible' })
  await page.waitForFunction(() => !document.querySelector('.move-grid button')?.disabled)
  await page.waitForTimeout(250)
}
const state = () => page.evaluate(() => JSON.parse(window.render_state_to_text()))
const step = (ms = 400) => page.evaluate((ms) => { window.step(ms) }, ms)
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })
const move = async (label, ms = 400) => { await page.getByRole('button', { name: new RegExp(`转动 ${label} `) }).click(); await step(ms) }
const check = (name, condition) => { assert.ok(condition, name); checks.push(name) }
try {
  await open(`${BASE}/?test=1`)
  await step(2200)
  await shot('01-desktop')
  await page.getByRole('checkbox', { name: '自动巡航' }).uncheck()
  const initial = await state()
  check('27 cubies, 27 unique grid positions', initial.cube.cubies === 27 && initial.cube.uniquePositions === 27)
  check('Reflection, 1024px textures, shadows and cosmic particles enabled', initial.environment.reflection && initial.environment.textureResolution === 1024 && initial.environment.shadows && initial.environment.meteors === 7)
  await move('R', 90)
  check('A whole layer contains exactly 9 cubies while turning', (await state()).cube.activeMembers === 9)
  await shot('02-layer-in-motion')
  await step()
  await page.getByRole('button', { name: '撤销上一步' }).click()
  await step()
  check('Undo restores exact positions and orientations', JSON.stringify((await state()).cube.signature) === JSON.stringify(initial.cube.signature))

  for (const label of ['U', 'D', 'L', 'R', 'F', 'B', 'M', 'E', 'S']) {
    for (let i = 0; i < 4; i++) await move(label)
    const result = await state()
    check(`${label} four quarter turns restore every cubie`, JSON.stringify(result.cube.signature) === JSON.stringify(initial.cube.signature) && result.cube.solved)
  }
  await page.getByRole('button', { name: '复位魔方' }).click()
  await step(0)
  const sequence = ['r', 'u', 'f', 'm', 'd', 'b', 'e', 'l', 's', 'u', 'r', 'f']
  for (const key of sequence) await page.keyboard.press(key)
  await step(5200)
  check('Mixed sequence preserves 27 distinct integer positions', (await state()).cube.uniquePositions === 27 && (await state()).cube.coordinatesValid)
  for (const key of [...sequence].reverse()) await page.keyboard.press(`Shift+${key.toUpperCase()}`)
  await step(5200)
  check('Mixed sequence plus inverse restores exact cube', JSON.stringify((await state()).cube.signature) === JSON.stringify(initial.cube.signature))

  await page.getByRole('button', { name: '复位魔方' }).click()
  await move('F')
  await page.getByRole('button', { name: '↺ 逆向', exact: true }).click()
  await move('F')
  check('Direction switch produces inverse move', JSON.stringify((await state()).cube.signature) === JSON.stringify(initial.cube.signature))
  await page.getByRole('button', { name: '↻ 顺向', exact: true }).click()
  await page.getByRole('button', { name: '复位魔方' }).click()
  await page.getByRole('button', { name: /随机打乱/ }).click()
  check('Scramble disables repeated scramble clicks', await page.getByRole('button', { name: /随机打乱/ }).isDisabled())
  await step(7500)
  check('Scramble completes exactly 18 moves', (await state()).cube.moveCount === 18 && !(await state()).cube.turnActive)
  await shot('03-scrambled')
  for (let i = 0; i < 18; i++) { await page.getByRole('button', { name: '撤销上一步' }).click(); await step() }
  check('Undo entire scramble returns solved cube and zero steps', (await state()).cube.solved && (await state()).cube.moveCount === 0)
  await move('U', 100)
  await page.getByRole('button', { name: '复位魔方' }).click()
  await step()
  check('Reset during animation clears active layer and restores exact cube', JSON.stringify((await state()).cube.signature) === JSON.stringify(initial.cube.signature) && !(await state()).cube.turnActive)
  const memoryBefore = (await state()).resources
  for (let i = 0; i < 8; i++) { await page.getByRole('button', { name: '复位魔方' }).click(); await step(0) }
  check('Repeated resets do not allocate GPU geometries or textures', JSON.stringify((await state()).resources) === JSON.stringify(memoryBefore))

  const beforeDrag = (await state()).camera
  await page.mouse.move(650, 440); await page.mouse.down(); await page.mouse.move(795, 485, { steps: 12 }); await page.mouse.up(); await step(100)
  check('Drag changes viewing angle', JSON.stringify((await state()).camera) !== JSON.stringify(beforeDrag))
  const distance = (xyz) => Math.hypot(...xyz)
  const beforeZoom = distance((await state()).camera)
  await page.mouse.wheel(0, -400); await page.waitForTimeout(150); await step(100)
  check('Wheel zoom changes camera distance', distance((await state()).camera) < beforeZoom)
  await page.getByRole('checkbox', { name: '自动巡航' }).check()
  const rotationBefore = (await state()).cube.rotation
  await step(3000)
  check('Auto cruise rotates the cube', JSON.stringify((await state()).cube.rotation) !== JSON.stringify(rotationBefore))
  await page.getByRole('checkbox', { name: '自动巡航' }).uncheck()
  const stoppedRotation = (await state()).cube.rotation
  await step(1000)
  check('Auto cruise switch stops cube rotation', JSON.stringify((await state()).cube.rotation) === JSON.stringify(stoppedRotation))
  await shot('04-orbit-zoom')

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    await open(`${BASE}/?test=1`)
    await step(2200)
    const bounds = await page.locator('.controls').boundingBox()
    check(`${viewport.width}px controls fit screen`, bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height)
    check(`${viewport.width}px all 9 layer buttons and both toggles visible`, await page.locator('.move-grid button:visible').count() === 9 && await page.locator('.toggle-row label:visible').count() === 2)
    await shot(`05-viewport-${viewport.width}`)
    if (viewport.width === 390) { await move('M'); check('Mobile middle layer is operable', (await state()).cube.moveCount === 1) }
  }

  if (round === '3') {
    for (const view of ['front', 'side', 'rear', 'top']) {
      await open(`${BASE}/?test=1&studio=1&view=${view}`)
      await shot(`06-studio-${view}`)
    }
    await open(BASE)
    const before = (await state()).elapsedSeconds
    await page.waitForTimeout(1400)
    check('Normal preview animates without test stepping', (await state()).elapsedSeconds > before + 0.5)
    await page.getByRole('button', { name: /转动 R / }).click()
    await page.waitForFunction(() => JSON.parse(window.render_state_to_text()).cube.moveCount === 1)
    check('Live preview completes a real-time layer turn', (await state()).cube.moveCount === 1)
    await shot('07-live-preview')
  }
  const finalState = await state()
  check('No runtime or resource errors', errors.length === 0 && failedRequests.length === 0 && !finalState.error)
  const report = { round, url: BASE, checks, errors, failedRequests, state: finalState }
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ round, passed: checks.length, checks, errors, failedRequests }, null, 2))
} catch (error) {
  await shot('failure').catch(() => {})
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ round, checks, errors, failedRequests, failure: String(error), state: await state().catch(() => null) }, null, 2))
  throw error
} finally {
  await browser.close()
}
