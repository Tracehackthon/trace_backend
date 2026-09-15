import React, { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import liukanshanImage from './assets/liukanshan.png'
import { candidateJudgement, seedObservations, type CandidateStatus, type Observation, type ObservationStatus } from './mock-data'
import { TracePanel } from './TracePanel'

// Module-level session store: closing/reopening the surface preserves the
// current page session, while a full refresh still resets this V1 mock state.
const traceSessionStore: {
  observations: Observation[]
  candidateStatus: CandidateStatus
} = {
  observations: seedObservations.map((observation) => ({ ...observation })),
  candidateStatus: '候选中',
}

const petSize = { width: 92, height: 116 }
// V1.5 card proportions: enough room for the complete status/title/source stack.
const orbitCardSize = { width: 206, height: 82 }
const orbitPadding = 12
const panelSize = { width: 460, height: 590 }
const panelInset = 16

type Viewport = { width: number; height: number }
type PetPosition = { x: number; y: number }
type TraceReminder = { observationId: string; text: string }
type DesktopCandidatePayload = { type?: string; observationId?: string; status?: ObservationStatus }
type TraceNativeBridge = {
  openDiscussion?: (url: string) => void
  onCandidate?: (listener: (payload: DesktopCandidatePayload) => void) => (() => void) | undefined
}
type OrbitItem =
  | { id: string; kind: 'observation'; observation: Observation }
  | { id: string; kind: 'guide' | 'capture'; kicker: string; title: string; detail: string; tone: string; action: 'capture' | 'focus-first' }

const reminderTemplates = [
  { observationId: 'evidence-traceability', suffix: '还在待确认，要看看吗？' },
  { observationId: 'uncertainty-first', suffix: '已经被采用，想复核它的适用范围吗？' },
  { observationId: 'decision-card-handoff', suffix: '需要回顾，要补一条反例吗？' },
  { observationId: 'evidence-traceability', suffix: '也许值得带一条证据继续讨论。' },
]

function getTraceNativeBridge() {
  return (window as Window & { traceNative?: TraceNativeBridge }).traceNative
}

function getViewport(): Viewport {
  if (typeof window === 'undefined') return { width: 1280, height: 720 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function getDefaultPetPosition(viewport: Viewport): PetPosition {
  return {
    x: Math.max(8, viewport.width - 22 - petSize.width),
    y: Math.max(8, viewport.height - 22 - petSize.height),
  }
}

function clampPetPosition(position: PetPosition, viewport: Viewport): PetPosition {
  return {
    x: Math.min(Math.max(8, position.x), Math.max(8, viewport.width - petSize.width - 8)),
    y: Math.min(Math.max(8, position.y), Math.max(8, viewport.height - petSize.height - 8)),
  }
}

function getPanelSize(viewport: Viewport, compact = false) {
  return {
    width: Math.min(compact ? 360 : panelSize.width, Math.max(280, viewport.width - panelInset * 2)),
    height: Math.min(compact ? 344 : panelSize.height, Math.max(compact ? 260 : 330, viewport.height - panelInset * 2)),
  }
}

function clampPanelPosition(position: PetPosition, viewport: Viewport, compact = false): PetPosition {
  const panel = getPanelSize(viewport, compact)
  return {
    x: Math.min(Math.max(panelInset, position.x), Math.max(panelInset, viewport.width - panel.width - panelInset)),
    y: Math.min(Math.max(panelInset, position.y), Math.max(panelInset, viewport.height - panel.height - panelInset)),
  }
}

function getDefaultPanelPosition(petPosition: PetPosition, viewport: Viewport): PetPosition {
  const panel = getPanelSize(viewport, true)
  const gap = 18
  const fitsRight = petPosition.x + petSize.width + gap + panel.width <= viewport.width - panelInset
  const fitsLeft = petPosition.x - gap - panel.width >= panelInset
  const x = fitsRight
    ? petPosition.x + petSize.width + gap
    : fitsLeft
      ? petPosition.x - panel.width - gap
      : petPosition.x < viewport.width / 2
        ? viewport.width - panel.width - panelInset
        : panelInset
  return clampPanelPosition({
    x,
    y: petPosition.y - panel.height * 0.55,
  }, viewport, true)
}

function distanceBetween(first: PetPosition, second: PetPosition) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getOrbitPositions(petPosition: PetPosition, viewport: Viewport, items: OrbitItem[]) {
  if (items.length === 0) return []

  const petCenter = {
    x: petPosition.x + petSize.width / 2,
    y: petPosition.y + petSize.height / 2,
  }
  const viewportCenter = { x: viewport.width / 2, y: viewport.height / 2 }
  const innerAngle = Math.atan2(viewportCenter.y - petCenter.y, viewportCenter.x - petCenter.x)
  // Compact fan: cards stay close to the pet and overlap as a deliberate
  // stack instead of spreading across a sparse outer orbit. The inner-facing
  // direction follows the pet as it is dragged around the viewport.
  const fanSpan = Math.min(2.55, Math.max(2.1, Math.min(viewport.width, viewport.height) * .00355))
  const step = items.length === 1 ? 0 : fanSpan / (items.length - 1)
  const radius = Math.max(150, Math.min(184, Math.min(viewport.width, viewport.height) * .255))
  const radialOffsets = [-10, 7, -4, 11, -8, 5, -3, 8]
  const tangentOffsets = [-5, 4, -3, 5, -4, 3, -2, 4]
  const rotations = [-6, 3, -2, 5, -4, 2, 6, -3]

  // Keep the stack inside the viewport, including the rotated card bounds.
  const cardHalfWidth = orbitCardSize.width / 2 + 18
  const cardHalfHeight = orbitCardSize.height / 2 + 22

  return items.map((_, index) => {
    const angle = innerAngle - fanSpan / 2 + step * index
    const radialOffset = radialOffsets[index % radialOffsets.length]
    const tangentOffset = tangentOffsets[index % tangentOffsets.length]
    const radialRadius = radius + radialOffset
    const targetCenter = {
      x: petCenter.x + radialRadius * Math.cos(angle) - tangentOffset * Math.sin(angle),
      y: petCenter.y + radialRadius * Math.sin(angle) + tangentOffset * Math.cos(angle),
    }
    const safeCenter = {
      x: Math.min(Math.max(cardHalfWidth + orbitPadding, targetCenter.x), viewport.width - cardHalfWidth - orbitPadding),
      y: Math.min(Math.max(cardHalfHeight + orbitPadding, targetCenter.y), viewport.height - cardHalfHeight - orbitPadding),
    }
    return {
      x: safeCenter.x - petPosition.x - 46,
      y: safeCenter.y - petPosition.y - 58,
      rotate: rotations[index % rotations.length],
    }
  })
}

export function TraceOverlay() {
  const [open, setOpen] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [focusedObservationId, setFocusedObservationId] = useState<string | undefined>()
  const [viewport, setViewport] = useState<Viewport>(() => getViewport())
  const [petPosition, setPetPosition] = useState<PetPosition | null>(null)
  const [observations, setObservations] = useState<Observation[]>(() => traceSessionStore.observations)
  const [candidateStatus, setCandidateStatus] = useState<CandidateStatus>(() => traceSessionStore.candidateStatus)
  const [discussionNotice, setDiscussionNotice] = useState('')
  const [reminder, setReminder] = useState<TraceReminder | null>(null)
  const [panelPosition, setPanelPosition] = useState<PetPosition | null>(null)
  const [hugging, setHugging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PetPosition; moved: boolean } | null>(null)
  const panelDragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PetPosition } | null>(null)
  const suppressClickRef = useRef(false)
  const petClickTimerRef = useRef<number | undefined>(undefined)
  const hugTimerRef = useRef<number | undefined>(undefined)
  const lastReminderIndexRef = useRef(-1)

  useEffect(() => {
    const handleResize = () => {
      const nextViewport = getViewport()
      setViewport(nextViewport)
      setPetPosition((current) => (current ? clampPetPosition(current, nextViewport) : current))
      setPanelPosition((current) => (current ? clampPanelPosition(current, nextViewport) : current))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => () => {
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    if (hugTimerRef.current !== undefined) window.clearTimeout(hugTimerRef.current)
  }, [])

  useEffect(() => {
    let timer: number | undefined
    const scheduleReminder = () => {
      const delay = 60_000 + Math.floor(Math.random() * 30_001)
      timer = window.setTimeout(() => {
        const available = reminderTemplates.filter((_, index) => index !== lastReminderIndexRef.current)
        const template = available[Math.floor(Math.random() * available.length)] ?? reminderTemplates[0]
        const selectedIndex = reminderTemplates.indexOf(template)
        lastReminderIndexRef.current = selectedIndex
        const observation = traceSessionStore.observations.find((item) => item.id === template.observationId) ?? traceSessionStore.observations[0]
        if (observation) setReminder({ observationId: observation.id, text: `上次那条「${observation.text}」${template.suffix}` })
        scheduleReminder()
      }, delay)
    }
    scheduleReminder()
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const receiveCandidate = (payload: DesktopCandidatePayload) => {
      if (payload.type !== 'trace.desktop.candidate' || !payload.observationId || !payload.status) return
      const nextStatus = payload.status
      if (nextStatus !== '候选中' && nextStatus !== '待确认') return

      traceSessionStore.observations = traceSessionStore.observations.map((observation) => (
        observation.id === payload.observationId ? { ...observation, status: nextStatus } : observation
      ))
      traceSessionStore.candidateStatus = nextStatus === '候选中' ? '候选中' : traceSessionStore.candidateStatus
      setObservations(traceSessionStore.observations)
      setCandidateStatus(traceSessionStore.candidateStatus)
      setFocusedObservationId(payload.observationId)
      setDiscussionNotice(nextStatus === '候选中'
        ? '桌面端已将这条观察标记为候选中。'
        : '桌面端已撤回候选，这条观察回到待确认。')
    }

    const receiveDesktopCandidate = (event: MessageEvent) => {
      if (event.origin !== 'http://127.0.0.1:4173') return
      receiveCandidate(event.data as DesktopCandidatePayload)
    }

    window.addEventListener('message', receiveDesktopCandidate)
    const removeNativeListener = getTraceNativeBridge()?.onCandidate?.(receiveCandidate)
    return () => {
      window.removeEventListener('message', receiveDesktopCandidate)
      removeNativeListener?.()
    }
  }, [])

  const currentPetPosition = petPosition ?? getDefaultPetPosition(viewport)
  const defaultPanelPosition = getDefaultPanelPosition(currentPetPosition, viewport)
  const currentPanelPosition = panelPosition ?? defaultPanelPosition
  const panelIsDetached = showPanel && Boolean(panelPosition) && distanceBetween(currentPanelPosition, defaultPanelPosition) > 170
  const isFirstUse = !observations.some((observation) => observation.isNew)
  const guideItems: OrbitItem[] = isFirstUse ? [
    { id: 'guide-open', kind: 'guide', kicker: '第 1 步', title: '单击刘看山', detail: '展开你的思考现场', tone: 'green', action: 'capture' },
    { id: 'guide-capture', kind: 'guide', kicker: '第 2 步', title: '双击刘看山', detail: '快速记录此刻的想法', tone: 'warm', action: 'capture' },
    { id: 'guide-return', kind: 'guide', kicker: '第 3 步', title: '点一条观察', detail: '回到对应内容继续思考', tone: 'mint', action: 'focus-first' },
  ] : []
  const observationItems: OrbitItem[] = observations.slice(0, isFirstUse ? 3 : 6).map((observation) => ({
    id: observation.id,
    kind: 'observation',
    observation,
  }))
  const captureItems: OrbitItem[] = [
    { id: 'capture-now', kind: 'capture', kicker: '随时可用', title: '开始记录你的想法', detail: '不用整理，先让它留下来', tone: 'cta-green', action: 'capture' },
    { id: 'capture-flash', kind: 'capture', kicker: '三秒入口', title: '接住刚冒出的念头', detail: '双击刘看山也可以', tone: 'cta-warm', action: 'capture' },
  ]
  const orbitItems = [...guideItems, ...observationItems, ...captureItems].slice(0, 8)
  const orbitPositions = getOrbitPositions(currentPetPosition, viewport, orbitItems)
  const overlayStyle: CSSProperties | undefined = petPosition
    ? { left: `${petPosition.x}px`, top: `${petPosition.y}px`, right: 'auto', bottom: 'auto' }
    : undefined
  const detailPanelStyle: CSSProperties = { left: `${currentPanelPosition.x}px`, top: `${currentPanelPosition.y}px`, right: 'auto', bottom: 'auto' }
  const panelSide = currentPanelPosition.x > currentPetPosition.x ? 'right' : 'left'

  const acceptObservation = (text: string) => {
    const nextObservation: Observation = {
      id: `capture-${Date.now()}`,
      text,
      status: '待确认',
      confidence: 50,
      createdAt: '刚刚',
      isNew: true,
    }
    traceSessionStore.observations = [nextObservation, ...traceSessionStore.observations]
    setObservations(traceSessionStore.observations)
    setDiscussionNotice('已接住：这条观察进入历史列表。')
  }

  const continueDiscussion = () => {
    const observation = observations.find((item) => item.id === focusedObservationId) ?? observations[0]
    if (!observation) {
      setDiscussionNotice('没有找到可继续讨论的观察。')
      return
    }
    const desktopUrl = new URL('http://127.0.0.1:4173/')
    desktopUrl.searchParams.set('from', 'deepseek-harness')
    desktopUrl.searchParams.set('observationId', observation.id)
    desktopUrl.searchParams.set('text', observation.text)
    desktopUrl.searchParams.set('status', observation.status)
    desktopUrl.searchParams.set('source', observation.source ?? 'Trace 历史观察')

    const nativeBridge = getTraceNativeBridge()
    if (nativeBridge?.openDiscussion) {
      desktopUrl.searchParams.set('from', 'trace-native')
      nativeBridge.openDiscussion(desktopUrl.toString())
      setDiscussionNotice('正在打开原生 Trace 深度讨论窗口。')
      return
    }

    window.open(desktopUrl.toString(), 'trace-desktop-agent', 'popup,width=1440,height=900')
    setDiscussionNotice('正在打开 Trace 桌面 Agent；如果页面未加载，请先启动 desktop 开发服务。')
  }

  const updateCandidate = (status: CandidateStatus) => {
    traceSessionStore.candidateStatus = status
    traceSessionStore.observations = traceSessionStore.observations.map((observation) => {
      if (observation.id !== candidateJudgement.linkedObservationId) return observation
      const linkedStatus = status === '候选中' ? '待确认' : status
      return { ...observation, status: linkedStatus }
    })
    setCandidateStatus(status)
    setObservations(traceSessionStore.observations)
    setDiscussionNotice(`候选判断已${status}，对应历史观察卡片已同步更新。`)
  }

  const openTrace = () => {
    setCollapsing(false)
    setHugging(false)
    setOpen(true)
  }

  const collapseTrace = () => {
    if (!open || collapsing) return
    setShowPanel(false)
    setPanelPosition(null)
    setCollapsing(true)
    window.setTimeout(() => {
      setOpen(false)
      setCollapsing(false)
    }, 500)
  }

  const handlePetPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const origin = { x: rect.left, y: rect.top }
    setPetPosition(origin)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePetPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true
    if (!drag.moved) return
    setPetPosition(clampPetPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY }, viewport))
    event.preventDefault()
  }

  const handlePetPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) suppressClickRef.current = true
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  const handlePetClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    petClickTimerRef.current = window.setTimeout(() => {
      if (open) collapseTrace()
      else openTrace()
      petClickTimerRef.current = undefined
    }, 240)
  }

  const handlePetDoubleClick = () => {
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    petClickTimerRef.current = undefined
    setCollapsing(false)
    setHugging(false)
    setOpen(true)
    setFocusedObservationId(undefined)
    setShowPanel(true)
    setPanelPosition(null)
  }

  const openCapturePanel = () => {
    setCollapsing(false)
    setHugging(false)
    setOpen(true)
    setShowPanel(true)
    setFocusedObservationId(undefined)
    setPanelPosition(null)
  }

  const handleOrbitItem = (item: OrbitItem) => {
    if (item.kind === 'observation') {
      setFocusedObservationId(item.observation.id)
      setShowPanel(true)
      setPanelPosition(null)
      return
    }
    if (item.action === 'focus-first' && observations[0]) {
      setFocusedObservationId(observations[0].id)
      setShowPanel(true)
      setPanelPosition(null)
      return
    }
    openCapturePanel()
  }

  const handlePanelPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    panelDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: currentPanelPosition,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePanelPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextPosition = {
      x: drag.origin.x + event.clientX - drag.startX,
      y: drag.origin.y + event.clientY - drag.startY,
    }
    const wasDetached = distanceBetween(currentPanelPosition, defaultPanelPosition) > 170
    const becomesDetached = distanceBetween(nextPosition, defaultPanelPosition) > 170
    if (wasDetached && !becomesDetached) {
      setPanelPosition(null)
      setHugging(true)
      if (hugTimerRef.current !== undefined) window.clearTimeout(hugTimerRef.current)
      hugTimerRef.current = window.setTimeout(() => {
        setHugging(false)
        hugTimerRef.current = undefined
      }, 600)
    } else {
      setPanelPosition(clampPanelPosition(nextPosition, viewport, !becomesDetached))
    }
    event.preventDefault()
  }

  const handlePanelPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    panelDragRef.current = null
  }

  const openReminder = () => {
    if (!reminder) return
    setFocusedObservationId(reminder.observationId)
    setCollapsing(false)
    setOpen(true)
    setShowPanel(true)
    setPanelPosition(null)
    setReminder(null)
  }

  return (
    <div className={`trace-overlay ${open ? 'trace-overlay-open' : ''} ${collapsing ? 'trace-overlay-collapsing' : ''}`} style={overlayStyle}>
      {reminder && !open && (
        <div className="trace-reminder-bubble" role="status">
          <button className="trace-reminder-open" type="button" onClick={openReminder} aria-label="打开被提醒的观察">
            <span className="trace-reminder-kicker">Trace 提醒</span>
            <strong>{reminder.text}</strong>
          </button>
          <button className="trace-reminder-close" type="button" onClick={() => setReminder(null)} aria-label="关闭本次提醒">×</button>
        </div>
      )}
      {open && (
        <button className="trace-gesture-backdrop" type="button" onClick={collapseTrace} aria-label="收回 Trace 卡片" />
      )}

      {open && !showPanel && (
        <div className="trace-orbit-stage" aria-label="Trace 历史观察卡片">
          {orbitItems.map((item, index) => {
            const position = orbitPositions[index]
            const brightnessClass = item.kind === 'observation'
              ? item.observation.isNew || (item.observation.id === candidateJudgement.linkedObservationId && candidateStatus === '候选中')
                ? 'trace-orbit-item-level-2'
                : 'trace-orbit-item-level-3'
              : 'trace-orbit-item-level-1'
            const toneClass = item.kind === 'observation'
              ? item.observation.isNew ? 'trace-orbit-item-new' : 'trace-orbit-item-existing'
              : `trace-orbit-item-${item.tone}`
            const orbitStyle = {
              '--trace-orbit-x': `${position.x}px`,
              '--trace-orbit-y': `${position.y}px`,
              '--trace-orbit-rotate': `${position.rotate}deg`,
              '--trace-orbit-delay': `${index * 40}ms`,
              '--trace-collapse-delay': `${(orbitItems.length - index - 1) * 40}ms`,
            } as CSSProperties
            return (
              <button
                className={`trace-orbit-item ${brightnessClass} ${toneClass}`}
                key={item.id}
                type="button"
                style={orbitStyle}
                onClick={() => handleOrbitItem(item)}
                aria-label={item.kind === 'observation' ? `打开观察：${item.observation.text}` : item.title}
              >
                {item.kind === 'observation' && item.observation.isNew && <span className="trace-new-orb-label">新想法</span>}
                <span className="trace-memory-card-body">
                  <span className="trace-memory-card-status">{item.kind === 'observation' ? item.observation.status : item.kicker}</span>
                  <strong>{item.kind === 'observation' ? item.observation.text : item.title}</strong>
                  <small>{item.kind === 'observation' ? item.observation.source ? `来源 ${item.observation.source}` : `置信度 ${item.observation.confidence}%` : item.detail}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {showPanel && (
        <div className={`trace-detail-panel ${panelIsDetached ? 'trace-detail-panel-detached' : `trace-detail-panel-linked trace-detail-panel-side-${panelSide}`}`} style={detailPanelStyle} onClick={(event) => event.stopPropagation()}>
          <TracePanel
            observations={observations}
            focusedObservationId={focusedObservationId}
            candidateStatus={candidateStatus}
            onAccept={acceptObservation}
            onCandidateAction={updateCandidate}
            onContinue={continueDiscussion}
            onClose={() => { setShowPanel(false); setPanelPosition(null) }}
            discussionNotice={discussionNotice}
            onHeaderPointerDown={handlePanelPointerDown}
            onHeaderPointerMove={handlePanelPointerMove}
            onHeaderPointerUp={handlePanelPointerUp}
            compact={!panelIsDetached}
          />
        </div>
      )}

      <button
        className={`trace-pet-button ${open ? 'trace-pet-button-active' : ''} ${panelIsDetached ? 'trace-pet-button-thinking' : ''} ${hugging ? 'trace-pet-button-hugging' : ''}`}
        type="button"
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerUp}
        onPointerCancel={handlePetPointerUp}
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
        aria-expanded={open}
        aria-label={open ? '收回 Trace' : '打开 Trace'}
      >
        <img className="trace-pet-image" src={liukanshanImage} alt="刘看山" />
      </button>
    </div>
  )
}
