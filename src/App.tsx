import { useEffect, useRef, useState } from 'react'
import { CosmicCube, type CubeCommand } from './scene/CosmicCube'
import { MOVES } from './scene/moves'
import type { CubeActivity } from './scene/types'
import './styles.css'

const moves = MOVES

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null)
  const experienceRef = useRef<CosmicCube | null>(null)
  const [autoRotate, setAutoRotate] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [soundOn, setSoundOn] = useState(false)
  const [inverse, setInverse] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [activity, setActivity] = useState<CubeActivity>({ busy: false, solved: true, canUndo: false, lastMove: '—' })
  const [moveCount, setMoveCount] = useState(0)
  const [status, setStatus] = useState('轨道已锁定')

  useEffect(() => {
    if (!hostRef.current) return
    let experience: CosmicCube | undefined
    const frame = requestAnimationFrame(() => {
      try {
        experience = new CosmicCube(hostRef.current!, {
          onMove: setMoveCount, onStatus: setStatus, onActivity: setActivity,
        })
        experienceRef.current = experience
        experience.setAutoRotate(autoRotate)
        experience.setSound(soundOn)
        setReady(true)
        setStatus('六面已归位')
      } catch (cause) {
        window.__LAST_ERROR__ = String(cause)
        setError('无法启动 3D 场景，请开启浏览器硬件加速后重试。')
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      experience?.dispose()
      experienceRef.current = null
    }
  }, [])

  useEffect(() => experienceRef.current?.setAutoRotate(autoRotate), [autoRotate])
  useEffect(() => experienceRef.current?.setSound(soundOn), [soundOn])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return
      const move = moves.find(({ label }) => label === event.key.toUpperCase())
      if (move) {
        event.preventDefault()
        const reverse = event.shiftKey ? !inverse : inverse
        experienceRef.current?.enqueue({ ...move.command, direction: reverse ? (move.command.direction === 1 ? -1 : 1) : move.command.direction })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inverse])

  const turn = (command: CubeCommand) => experienceRef.current?.enqueue({ ...command, direction: inverse ? (command.direction === 1 ? -1 : 1) : command.direction })
  const scramble = () => {
    experienceRef.current?.scramble(18)
    setStatus('量子序列写入中')
  }
  const reset = () => {
    experienceRef.current?.reset()
    setMoveCount(0)
    setStatus('核心已重新校准')
  }

  return (
    <main className="app-shell">
      <div ref={hostRef} className="scene-host" aria-label="银河星云中的可交互三阶魔方" />
      <div className="vignette" aria-hidden="true" />
      {!ready && <div className="loading-state" role="status"><span className="loading-orbit" /><strong>{error || '正在点亮这片星河'}</strong>{error ? <button onClick={() => location.reload()}>重新加载</button> : <small>PREPARING YOUR UNIVERSE</small>}</div>}
      <div className="live-badge"><i /> LIVE EXPERIENCE <span>01 / ∞</span></div>
      <header className="brand-block">
        <div className="eyebrow"><span className="eyebrow-line" /> ORBITAL LAB / EXPERIMENT 03</div>
        <h1>COSMIC<br /><em>CUBE</em><span className="title-dot">.</span></h1>
        <p>让每一次转动，穿越星河。</p>
        <div className="edition">3 × 3 × 3 <span /> INTERACTIVE SPACE OBJECT</div>
      </header>

      <aside className="telemetry" aria-label="场景状态">
        <div className="panel-label">✦ MISSION STATUS</div>
        <div className="telemetry-grid">
          <div><span>当前步数</span><strong data-testid="move-count">{String(moveCount).padStart(2, '0')}</strong></div>
          <div><span>最近转动</span><strong>{activity.lastMove}</strong></div>
        </div>
        <div className="status-line" role="status"><i />{status}</div>
        <div className="spectrum" aria-hidden="true">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ height: `${4 + Math.sin(i * 0.8) ** 2 * 17 + Math.cos(i * 0.4) ** 2 * 8}px` }} />)}</div>
      </aside>

      <section className="controls glass-panel" aria-label="魔方控制台">
        <div className="control-heading">
          <div><span>CUBE CONTROLS</span><small>你的指尖，决定下一个维度</small></div>
          <span className={`cube-badge ${activity.solved ? 'solved' : ''}`}>{activity.busy ? '转动中' : activity.solved ? '已归位' : '探索中'}</span>
        </div>
        <div className="direction-row" aria-label="转动方向"><button className={!inverse ? 'selected' : ''} aria-pressed={!inverse} onClick={() => setInverse(false)}>↻ 顺向</button><button className={inverse ? 'selected' : ''} aria-pressed={inverse} onClick={() => setInverse(true)}>↺ 逆向</button></div>
        <div className="move-grid">
          {moves.map(({ label, name, command }) => (
            <button key={label} disabled={!ready} onClick={() => turn(command)} aria-label={`转动 ${label} ${name}`} title={`${name} · 键盘 ${label}，Shift 反向`}>
              <span>{label}{inverse && <sup>′</sup>}</span><small>{name}</small>
            </button>
          ))}
        </div>
        <div className="action-row">
          <button className="primary-action" disabled={!ready || activity.busy} onClick={scramble}><span className="action-icon">⤨</span> 随机打乱 <small>18 步</small></button>
          <button className="icon-action" disabled={!activity.canUndo} onClick={() => experienceRef.current?.undo()} aria-label="撤销上一步" title="撤销上一步">↶</button>
          <button className="icon-action" disabled={!ready} onClick={reset} aria-label="复位魔方" title="复位魔方">⟲</button>
        </div>
        <div className="toggle-row">
          <label><span><b>自动巡航</b><small>让魔方缓缓自转</small></span><input aria-label="自动巡航" type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} /><i /></label>
          <label><span><b>机械音效</b><small>感受每一次转动</small></span><input aria-label="机械音效" type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} /><i /></label>
        </div>
        <div className="keyboard-note"><kbd>SHIFT</kbd> + 字母键反向转动</div>
      </section>

      <div className="interaction-hint"><span className="mouse-icon">↔</span><b>拖拽观察</b><i />滚轮 / 双指缩放</div>
      <footer><span>BUILT FOR CURIOSITY ✦</span><span className="coordinates">SOMEWHERE, BEYOND THE ORDINARY.</span><span>银河魔方 © 2026</span></footer>
    </main>
  )
}
