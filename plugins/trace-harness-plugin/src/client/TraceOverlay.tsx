import React, { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import crawlAImage from './assets/pet/crawl_A.png'
import crawlBImage from './assets/pet/crawl_B.png'
import sitAImage from './assets/pet/sit_A.png'
import transitionAImage from './assets/pet/transition_A.png'
import transitionBImage from './assets/pet/transition_B.png'
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
const petBottomInset = 6
// Compact memory bubbles: the fan geometry remains unchanged, while the cards
// themselves are one size tighter so they do not cover the reading canvas.
const orbitCardSize = { width: 188, height: 74 }
const orbitPadding = 12
const panelSize = { width: 460, height: 590 }
const panelInset = 16

type Viewport = { width: number; height: number }
type PetPosition = { x: number; y: number }
type TraceReminder = { observationId: string; text: string }
type ReminderPlacement = { side: 'top' | 'bottom' | 'inside'; style: CSSProperties }
type PetPose = 'crawl' | 'sit'
type PetFacing = 'left' | 'right'
type PoseTransition = 'to-crawl' | 'to-sit'
type PoseTransitionPhase = 0 | 1 | 2
type OrbitPosition = {
  x: number
  y: number
  rotate: number
  originX: number
  originY: number
  originRotate: number
  stacked: boolean
  stackTop: boolean
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

function getViewport(): Viewport {
  if (typeof window === 'undefined') return { width: 1280, height: 720 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function getDefaultPetPosition(viewport: Viewport): PetPosition {
  return {
    x: Math.max(8, viewport.width - 22 - petSize.width),
    y: Math.max(8, viewport.height - petBottomInset - petSize.height),
  }
}

function clampPetPosition(position: PetPosition, viewport: Viewport): PetPosition {
  return {
    x: Math.min(Math.max(8, position.x), Math.max(8, viewport.width - petSize.width - 8)),
    y: Math.min(Math.max(8, position.y), Math.max(8, viewport.height - petSize.height - petBottomInset)),
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

function getOrbitPositions(petPosition: PetPosition, viewport: Viewport, items: OrbitItem[]): OrbitPosition[] {
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

  const naturalCenters = items.map((_, index) => {
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
    return safeCenter
  })

  // Compression is driven by actual viewport pressure, not by a corner flag.
  // Use the overlap over the smaller card's area so a card covered by >=80% of
  // another card joins the same compact stack.
  const overlapRatio = (first: PetPosition, second: PetPosition) => {
    const firstLeft = first.x - orbitCardSize.width / 2
    const firstRight = first.x + orbitCardSize.width / 2
    const firstTop = first.y - orbitCardSize.height / 2
    const firstBottom = first.y + orbitCardSize.height / 2
    const secondLeft = second.x - orbitCardSize.width / 2
    const secondRight = second.x + orbitCardSize.width / 2
    const secondTop = second.y - orbitCardSize.height / 2
    const secondBottom = second.y + orbitCardSize.height / 2
    const width = Math.max(0, Math.min(firstRight, secondRight) - Math.max(firstLeft, secondLeft))
    const height = Math.max(0, Math.min(firstBottom, secondBottom) - Math.max(firstTop, secondTop))
    return (width * height) / (orbitCardSize.width * orbitCardSize.height)
  }

  const parent = items.map((_, index) => index)
  const find = (index: number): number => {
    if (parent[index] === index) return index
    parent[index] = find(parent[index])
    return parent[index]
  }
  const join = (first: number, second: number) => {
    const firstRoot = find(first)
    const secondRoot = find(second)
    if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot
  }
  for (let first = 0; first < naturalCenters.length; first += 1) {
    for (let second = first + 1; second < naturalCenters.length; second += 1) {
      if (overlapRatio(naturalCenters[first], naturalCenters[second]) >= .8) join(first, second)
    }
  }

  const groups = new Map<number, number[]>()
  parent.forEach((_, index) => {
    const root = find(index)
    const group = groups.get(root) ?? []
    group.push(index)
    groups.set(root, group)
  })
  const stackedByIndex = new Map<number, { center: PetPosition; top: boolean }>()
  const clampCardCenter = (center: PetPosition) => ({
    x: Math.min(Math.max(cardHalfWidth + orbitPadding, center.x), viewport.width - cardHalfWidth - orbitPadding),
    y: Math.min(Math.max(cardHalfHeight + orbitPadding, center.y), viewport.height - cardHalfHeight - orbitPadding),
  })
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const average = members.reduce((sum, index) => ({
      x: sum.x + naturalCenters[index].x / members.length,
      y: sum.y + naturalCenters[index].y / members.length,
    }), { x: 0, y: 0 })
    const anchor = clampCardCenter(average)
    const direction = {
      x: anchor.x <= viewport.width / 2 ? 1 : -1,
      y: anchor.y <= viewport.height / 2 ? 1 : -1,
    }
    const length = Math.hypot(direction.x, direction.y * .35)
    const tangent = { x: direction.x / length, y: direction.y * .35 / length }
    members.forEach((index, stackIndex) => {
      stackedByIndex.set(index, {
        center: clampCardCenter({ x: anchor.x + tangent.x * stackIndex * 20, y: anchor.y + tangent.y * stackIndex * 20 }),
        top: stackIndex === members.length - 1,
      })
    })
  }

  return naturalCenters.map((naturalCenter, index) => {
    const stacked = stackedByIndex.get(index)
    const center = stacked?.center ?? naturalCenter
    return {
      x: center.x - petPosition.x - 46,
      y: center.y - petPosition.y - 58,
      rotate: rotations[index % rotations.length],
      originX: 0,
      originY: 0,
      originRotate: 0,
      stacked: Boolean(stacked),
      stackTop: stacked?.top ?? false,
    }
  })
}

function getReminderPlacement(petPosition: PetPosition, viewport: Viewport): ReminderPlacement {
  const width = Math.max(0, Math.min(232, viewport.width - 32))
  const height = 72
  const gap = 42
  const petCenter = {
    x: petPosition.x + petSize.width / 2,
    y: petPosition.y + petSize.height / 2,
  }
  const clampLeft = (left: number) => Math.min(Math.max(16, left), Math.max(16, viewport.width - width - 16))
  const clampTop = (top: number) => Math.min(Math.max(16, top), Math.max(16, viewport.height - height - 16))
  const avoidReadingCenter = (left: number) => {
    const centerStart = viewport.width * .42
    const centerEnd = viewport.width * .58
    const overlapsReadingZone = left < centerEnd && left + width > centerStart
    if (!overlapsReadingZone) return clampLeft(left)
    const pushedLeft = petCenter.x < viewport.width / 2
      ? centerEnd + 18
      : centerStart - width - 18
    return clampLeft(pushedLeft)
  }
  const top = petPosition.y - gap - height
  if (top >= 16) {
    return { side: 'top', style: { left: `${avoidReadingCenter(petCenter.x - width / 2)}px`, top: `${top}px`, width: `${width}px` } }
  }
  const bottom = petPosition.y + petSize.height + gap
  if (bottom + height <= viewport.height - 16) {
    return { side: 'bottom', style: { left: `${avoidReadingCenter(petCenter.x - width / 2)}px`, top: `${bottom}px`, width: `${width}px` } }
  }
  const inwardLeft = petCenter.x < viewport.width / 2
    ? petPosition.x + petSize.width + 18
    : petPosition.x - width - 18
  return {
    side: 'inside',
    style: { left: `${clampLeft(inwardLeft)}px`, top: `${clampTop(petCenter.y - height / 2)}px`, width: `${width}px` },
  }
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
  // Idle and reminder states are calm, fixed-frame sitting. The low crawling
  // posture belongs specifically to the expanded memory fan.
  const [petPose, setPetPose] = useState<PetPose>('sit')
  const [petFrame, setPetFrame] = useState<0 | 1>(0)
  const [petFacing, setPetFacing] = useState<PetFacing>('left')
  const [crawlRunning, setCrawlRunning] = useState(false)
  const [poseTransition, setPoseTransition] = useState<PoseTransition | null>(null)
  const [poseTransitionPhase, setPoseTransitionPhase] = useState<PoseTransitionPhase>(0)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PetPosition; moved: boolean } | null>(null)
  const panelDragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PetPosition } | null>(null)
  const suppressClickRef = useRef(false)
  const petClickTimerRef = useRef<number | undefined>()
  const hugTimerRef = useRef<number | undefined>()
  const crawlTimerRef = useRef<number | undefined>()
  const poseTransitionTimersRef = useRef<number[]>([])
  const poseTransitionLockRef = useRef(false)
  const petClickSideRef = useRef<'left' | 'right'>('left')
  const lastReminderIndexRef = useRef(-1)
  const openRef = useRef(open)

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
    if (crawlTimerRef.current !== undefined) window.clearTimeout(crawlTimerRef.current)
    poseTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    poseTransitionTimersRef.current = []
    poseTransitionLockRef.current = false
  }, [])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    // Only the intentional crawl step cycles bitmap frames. Sitting stays on
    // sit_A; its sense of life comes from CSS sway, not image-frame flicker.
    if (petPose !== 'crawl' || !crawlRunning) {
      setPetFrame(0)
      return
    }
    const interval = window.setInterval(() => {
      setPetFrame((frame) => frame === 0 ? 1 : 0)
    }, 200)
    return () => window.clearInterval(interval)
  }, [petPose, crawlRunning])

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
        if (observation) {
          // A reminder may arrive while the fan is already open. In that case
          // retain its crawl posture; closed/idle reminder states sit calmly.
          setPetPose(openRef.current ? 'crawl' : 'sit')
          setPetFrame(0)
          setReminder({ observationId: observation.id, text: `上次那条「${observation.text}」${template.suffix}` })
        }
        scheduleReminder()
      }, delay)
    }
    scheduleReminder()
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const receiveDesktopCandidate = (event: MessageEvent) => {
      if (event.origin !== 'http://127.0.0.1:4173') return
      const payload = event.data as { type?: string; observationId?: string; status?: ObservationStatus }
      if (payload.type !== 'trace.desktop.candidate' || !payload.observationId || !payload.status) return
      if (payload.status !== '候选中' && payload.status !== '待确认') return

      traceSessionStore.observations = traceSessionStore.observations.map((observation) => (
        observation.id === payload.observationId ? { ...observation, status: payload.status } : observation
      ))
      traceSessionStore.candidateStatus = payload.status === '候选中' ? '候选中' : traceSessionStore.candidateStatus
      setObservations(traceSessionStore.observations)
      setCandidateStatus(traceSessionStore.candidateStatus)
      setFocusedObservationId(payload.observationId)
      setDiscussionNotice(payload.status === '候选中'
        ? '桌面端已将这条观察标记为候选中。'
        : '桌面端已撤回候选，这条观察回到待确认。')
    }
    window.addEventListener('message', receiveDesktopCandidate)
    return () => window.removeEventListener('message', receiveDesktopCandidate)
  }, [])

  const currentPetPosition = petPosition ?? getDefaultPetPosition(viewport)
  const lastPetCenterXRef = useRef<number | null>(null)
  useEffect(() => {
    const centerX = currentPetPosition.x + petSize.width / 2
    const lastX = lastPetCenterXRef.current
    if (lastX === null) {
      setPetFacing(centerX < viewport.width / 2 ? 'right' : 'left')
    } else if (Math.abs(centerX - lastX) > 1) {
      setPetFacing(centerX > lastX ? 'right' : 'left')
    }
    lastPetCenterXRef.current = centerX
  }, [currentPetPosition.x, viewport.width])
  const reminderPlacement = getReminderPlacement(currentPetPosition, viewport)
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
  const petImage = poseTransition === 'to-crawl'
    ? poseTransitionPhase === 0 ? sitAImage
      : poseTransitionPhase === 1 ? transitionAImage
        : transitionBImage
    : poseTransition === 'to-sit'
      ? poseTransitionPhase === 0 ? crawlAImage
        : poseTransitionPhase === 1 ? transitionBImage
          : transitionAImage
      : petPose === 'sit'
        ? sitAImage
        : petFrame === 0 ? crawlAImage : crawlBImage
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

  const clearPoseTransitionTimers = () => {
    poseTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    poseTransitionTimersRef.current = []
  }

  const startPoseTransition = (direction: PoseTransition, onComplete?: () => void) => {
    if (poseTransitionLockRef.current) return false
    poseTransitionLockRef.current = true
    clearPoseTransitionTimers()
    if (crawlTimerRef.current !== undefined) {
      window.clearTimeout(crawlTimerRef.current)
      crawlTimerRef.current = undefined
    }
    setCrawlRunning(false)
    setPetFrame(0)
    setPoseTransition(direction)
    setPoseTransitionPhase(0)

    const transitionA = window.setTimeout(() => setPoseTransitionPhase(1), 140)
    const transitionB = window.setTimeout(() => setPoseTransitionPhase(2), 280)
    const complete = window.setTimeout(() => {
      setPetPose(direction === 'to-crawl' ? 'crawl' : 'sit')
      setPetFrame(0)
      setPoseTransition(null)
      setPoseTransitionPhase(0)
      poseTransitionTimersRef.current = []
      poseTransitionLockRef.current = false
      onComplete?.()
    }, 420)
    poseTransitionTimersRef.current = [transitionA, transitionB, complete]
    return true
  }

  const showFan = () => {
    setCollapsing(false)
    setHugging(false)
    setCrawlRunning(false)
    setPetPose('crawl')
    setPetFrame(0)
    setOpen(true)
  }

  const settleToSit = (onComplete: () => void) => {
    if (poseTransitionLockRef.current) return false
    if (petPose === 'sit') {
      setCrawlRunning(false)
      setPetFrame(0)
      onComplete()
      return true
    }
    return startPoseTransition('to-sit', onComplete)
  }

  const collapseTrace = () => {
    if (!open || collapsing || poseTransitionLockRef.current) return
    setShowPanel(false)
    setPanelPosition(null)
    setCollapsing(true)
    const finishCollapse = () => {
      setOpen(false)
      setCollapsing(false)
      setPetPose('sit')
      setPetFrame(0)
    }
    if (petPose === 'crawl') {
      startPoseTransition('to-sit', finishCollapse)
      return
    }
    window.setTimeout(finishCollapse, 230)
  }

  const closePanelToFan = () => {
    if (poseTransitionLockRef.current) return
    const revealFan = () => {
      setShowPanel(false)
      setPanelPosition(null)
      showFan()
    }
    if (petPose === 'crawl') {
      revealFan()
      return
    }
    startPoseTransition('to-crawl', revealFan)
  }

  const handlePetPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || poseTransitionLockRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const origin = { x: rect.left, y: rect.top }
    petClickSideRef.current = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
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
    if (poseTransitionLockRef.current) return
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    petClickTimerRef.current = window.setTimeout(() => {
      if (poseTransitionLockRef.current) return
      if (open) {
        collapseTrace()
      } else {
        const direction = petClickSideRef.current
        const beginCrawlStep = () => {
          showFan()
          setCrawlRunning(true)
          setPetPosition((current) => {
            const origin = current ?? getDefaultPetPosition(viewport)
            return clampPetPosition({ x: origin.x + (direction === 'left' ? -70 : 70), y: origin.y }, viewport)
          })
          if (crawlTimerRef.current !== undefined) window.clearTimeout(crawlTimerRef.current)
          crawlTimerRef.current = window.setTimeout(() => {
            setCrawlRunning(false)
            crawlTimerRef.current = undefined
          }, 440)
        }
        // Turn before the intermediate frames begin, so scaleX consistently
        // applies to the complete sit → crawl bitmap sequence.
        setPetFacing(direction)
        if (petPose === 'sit') startPoseTransition('to-crawl', beginCrawlStep)
        else beginCrawlStep()
      }
      petClickTimerRef.current = undefined
    }, 240)
  }

  const handlePetDoubleClick = () => {
    if (poseTransitionLockRef.current) return
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    petClickTimerRef.current = undefined
    if (crawlTimerRef.current !== undefined) window.clearTimeout(crawlTimerRef.current)
    crawlTimerRef.current = undefined
    openCapturePanel()
  }

  const openPanel = (observationId?: string) => {
    if (poseTransitionLockRef.current) return
    const showPanel = () => {
      setCollapsing(false)
      setHugging(false)
      setCrawlRunning(false)
      setPetPose('sit')
      setPetFrame(0)
      setOpen(true)
      setFocusedObservationId(observationId)
      setShowPanel(true)
      setPanelPosition(null)
    }
    settleToSit(showPanel)
  }

  const openCapturePanel = () => {
    openPanel()
  }

  const handleOrbitItem = (item: OrbitItem) => {
    if (item.kind === 'observation') {
      openPanel(item.observation.id)
      return
    }
    if (item.action === 'focus-first' && observations[0]) {
      openPanel(observations[0].id)
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
    openPanel(reminder.observationId)
    setReminder(null)
  }

  return (
    <div className={`trace-overlay ${open ? 'trace-overlay-open' : ''} ${collapsing ? 'trace-overlay-collapsing' : ''} ${poseTransition ? 'trace-overlay-transitioning' : ''}`} style={overlayStyle}>
      {reminder && !open && (
        <div className={`trace-reminder-bubble trace-reminder-bubble-${reminderPlacement.side}`} style={reminderPlacement.style} role="status">
          <span className="trace-reminder-cloud-bump" aria-hidden="true" />
          <span className="trace-reminder-bubbles" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
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
            const observation = item.kind === 'observation' ? item.observation : undefined
            const brightnessClass = item.kind === 'observation'
              ? observation?.isNew || (observation.id === candidateJudgement.linkedObservationId && candidateStatus === '候选中')
                ? 'trace-orbit-item-level-2'
                : 'trace-orbit-item-level-3'
              : 'trace-orbit-item-level-1'
            const toneClass = item.kind === 'observation'
              ? observation?.isNew ? 'trace-orbit-item-new' : 'trace-orbit-item-existing'
              : `trace-orbit-item-${item.tone}`
            return (
              <button
                className={`trace-orbit-item ${brightnessClass} ${toneClass} ${position.stacked ? 'trace-orbit-item-stacked' : ''}`}
                key={item.id}
                type="button"
                style={{
                  '--trace-orbit-x': `${position.x}px`,
                  '--trace-orbit-y': `${position.y}px`,
                  '--trace-orbit-rotate': `${position.rotate}deg`,
                  '--trace-orbit-origin-x': `${position.originX}px`,
                  '--trace-orbit-origin-y': `${position.originY}px`,
                  '--trace-orbit-origin-rotate': `${position.originRotate}deg`,
                  '--trace-orbit-delay': `${index * 40}ms`,
                  '--trace-collapse-delay': `${(orbitItems.length - index - 1) * 40}ms`,
                }}
                onClick={() => handleOrbitItem(item)}
                aria-label={observation ? `打开观察：${observation.text}` : item.title}
              >
                {observation?.isNew && <span className="trace-new-orb-label">新想法</span>}
                {position.stackTop && (
                  <span className="trace-stack-summary" title={observation ? observation.text : item.title}>
                    {observation ? observation.text : item.title}
                  </span>
                )}
                <span className="trace-memory-card-body">
                  <span className="trace-memory-card-status">{observation ? observation.status : item.kicker}</span>
                  <strong>{observation ? observation.text : item.title}</strong>
                  <small>{observation ? observation.source ? `来源 ${observation.source}` : `置信度 ${observation.confidence}%` : item.detail}</small>
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
            onClose={closePanelToFan}
            discussionNotice={discussionNotice}
            onHeaderPointerDown={handlePanelPointerDown}
            onHeaderPointerMove={handlePanelPointerMove}
            onHeaderPointerUp={handlePanelPointerUp}
            compact={!panelIsDetached}
          />
        </div>
      )}

      <button
        className={`trace-pet-button trace-pet-button-${petPose} trace-pet-button-frame-${petFrame} trace-pet-button-facing-${petFacing} ${poseTransition ? `trace-pet-button-transition-${poseTransition}` : ''} ${crawlRunning ? 'trace-pet-button-crawling' : ''} ${open ? 'trace-pet-button-active' : ''} ${panelIsDetached ? 'trace-pet-button-thinking' : ''} ${hugging ? 'trace-pet-button-hugging' : ''}`}
        type="button"
        disabled={Boolean(poseTransition)}
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerUp}
        onPointerCancel={handlePetPointerUp}
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
        aria-expanded={open}
        aria-label={open ? '收回 Trace' : '打开 Trace'}
      >
        <span className="trace-pet-shadow" aria-hidden="true" />
        <span className="trace-pet-visual" data-pose={petPose} data-frame={petFrame} data-transition={poseTransition ?? 'none'}>
          <img className="trace-pet-image" src={petImage} alt="刘看山" />
        </span>
      </button>
    </div>
  )
}
