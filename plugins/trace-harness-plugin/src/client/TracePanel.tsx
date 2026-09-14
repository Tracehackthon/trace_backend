import React, { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { candidateJudgement, type CandidateStatus, type Observation, type ObservationStatus } from './mock-data'
import { TraceMap } from './TraceMap'

type TracePanelProps = {
  observations: Observation[]
  focusedObservationId?: string
  onAccept: (text: string) => void
  candidateStatus: CandidateStatus
  onCandidateAction: (status: CandidateStatus) => void
  onContinue: () => void
  onClose: () => void
  discussionNotice: string
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onHeaderPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void
  onHeaderPointerUp?: (event: ReactPointerEvent<HTMLElement>) => void
  compact?: boolean
}

const statusClass: Record<ObservationStatus, string> = {
  待确认: 'pending',
  候选中: 'candidate',
  已采用: 'adopted',
  需回顾: 'review',
  已暂存: 'stored',
  已拒绝: 'rejected',
}

const candidateStatusClass: Record<CandidateStatus, string> = {
  候选中: 'candidate',
  已采用: 'adopted',
  已暂存: 'stored',
  已拒绝: 'rejected',
}

export function TracePanel({
  observations,
  focusedObservationId,
  onAccept,
  candidateStatus,
  onCandidateAction,
  onContinue,
  onClose,
  discussionNotice,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  compact = false,
}: TracePanelProps) {
  const [draft, setDraft] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null)
  const focusedCardRef = useRef<HTMLElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const recordingTimerRef = useRef<number | undefined>()
  const focusedObservation = observations.find((observation) => observation.id === focusedObservationId)

  useEffect(() => {
    if (!focusedObservationId) return
    focusedCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedObservationId])

  useEffect(() => () => {
    if (recordingTimerRef.current !== undefined) window.clearTimeout(recordingTimerRef.current)
    if (imagePreview) URL.revokeObjectURL(imagePreview.url)
  }, [imagePreview])

  const clearImagePreview = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview.url)
    setImagePreview(null)
  }

  const startMockRecording = () => {
    if (isRecording) return
    setIsRecording(true)
    recordingTimerRef.current = window.setTimeout(() => {
      setDraft('刚才在协作里发现：先保留证据和待回答问题，比立刻总结更重要。')
      setIsRecording(false)
      recordingTimerRef.current = undefined
    }, 2000)
  }

  const selectImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    clearImagePreview()
    setImagePreview({ url: URL.createObjectURL(file), name: file.name })
    event.target.value = ''
  }

  const submitObservation = () => {
    const text = draft.trim()
    if (!text) return
    onAccept(text)
    setDraft('')
    clearImagePreview()
  }

  return (
    <aside className={`trace-panel ${compact ? 'trace-panel-compact' : ''}`} aria-label="Trace 思考沉淀面板">
      <header
        className="trace-panel-header trace-panel-drag-handle"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div>
          <span className="trace-eyebrow">TRACE · THINKING LAYER</span>
          <h2>先接住，再想清楚</h2>
          <p>不用现在分类，先把现场留在这里。</p>
        </div>
        <button className="trace-icon-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="收起 Trace">
          ×
        </button>
      </header>

      <section className="trace-section trace-capture-section">
        <label className="trace-label" htmlFor="trace-capture-input">此刻想留下什么？</label>
        <div className="trace-capture-input-row">
          <textarea
            id="trace-capture-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="看到的现象、踩到的坑、突然想通的判断……"
            rows={3}
          />
          <div className="trace-capture-media-actions" aria-label="轻接收方式">
            <button className={`trace-media-button ${isRecording ? 'trace-media-button-recording' : ''}`} type="button" onClick={startMockRecording} aria-label="模拟语音输入" title="模拟语音输入">
              {isRecording ? <span className="trace-recording-wave" aria-label="正在录音"><i /><i /><i /><i /></span> : '◉'}
            </button>
            <button className="trace-media-button" type="button" onClick={() => imageInputRef.current?.click()} aria-label="选择图片" title="选择图片">
              ▧
            </button>
            <input ref={imageInputRef} className="trace-file-input" type="file" accept="image/*" onChange={selectImage} />
          </div>
        </div>
        {isRecording && <p className="trace-recording-label">正在模拟录音，2 秒后将填入转写文本…</p>}
        {imagePreview && (
          <div className="trace-image-preview">
            <img src={imagePreview.url} alt="待接住的图片缩略图" />
            <div>
              <strong>图片现场已接住</strong>
              <span>Mock 识别：一张与当前思考有关的现场截图</span>
              <small>{imagePreview.name}</small>
            </div>
            <button type="button" onClick={clearImagePreview} aria-label="移除图片">×</button>
          </div>
        )}
        <div className="trace-action-row">
          <button className="trace-button trace-button-primary" type="button" onClick={submitObservation}>
            接住它
          </button>
          <button className="trace-button trace-button-secondary" type="button" onClick={onContinue}>
            继续讨论
          </button>
        </div>
        {discussionNotice && <p className="trace-inline-notice">{discussionNotice}</p>}
      </section>

      {compact && focusedObservation && (
        <article className="trace-compact-observation" aria-label="当前观察详情">
          <span className={`trace-status trace-status-${statusClass[focusedObservation.status]}`}>{focusedObservation.status}</span>
          <strong>{focusedObservation.text}</strong>
          <small>置信度 {focusedObservation.confidence}% · {focusedObservation.createdAt}</small>
        </article>
      )}

      <section className="trace-section" aria-labelledby="trace-history-title">
        <div className="trace-section-heading">
          <div>
            <span className="trace-eyebrow">现场回收站</span>
            <h3 id="trace-history-title">历史观察</h3>
          </div>
          <span className="trace-count">{observations.length} 条</span>
        </div>
        <div className="trace-observation-list">
          {observations.map((observation) => (
            <article
              className={`trace-observation-card ${observation.id === focusedObservationId ? 'trace-observation-card-focused' : ''}`}
              key={observation.id}
              ref={observation.id === focusedObservationId ? focusedCardRef : undefined}
              data-trace-observation-id={observation.id}
            >
              <div className="trace-observation-main">
                <p>{observation.text}</p>
                <div className="trace-meta-row">
                  <span className={`trace-status trace-status-${statusClass[observation.status]}`}>{observation.status}</span>
                  <span>置信度 {observation.confidence}%</span>
                  {observation.source && <span>来源 {observation.source}</span>}
                </div>
              </div>
              <time>{observation.createdAt}</time>
            </article>
          ))}
        </div>
      </section>

      <TraceMap />

      <section className="trace-section trace-candidate-section" aria-labelledby="trace-candidate-title">
        <div className="trace-section-heading">
          <div>
            <span className="trace-eyebrow">待你确认</span>
            <h3 id="trace-candidate-title">候选判断</h3>
          </div>
          <div className="trace-candidate-heading-meta">
            <span className={`trace-status trace-status-${candidateStatusClass[candidateStatus]}`}>{candidateStatus}</span>
            <span className="trace-confidence">{candidateJudgement.confidence}%</span>
          </div>
        </div>
        <div className="trace-candidate-card">
          <strong>{candidateJudgement.title}</strong>
          <p>{candidateJudgement.body}</p>
          <p className="trace-candidate-link">同步历史卡片：检索结果必须附带可追溯证据</p>
          <div className="trace-action-row trace-candidate-actions">
            <button className={`trace-button trace-button-primary ${candidateStatus === '已采用' ? 'trace-button-selected' : ''}`} type="button" onClick={() => onCandidateAction('已采用')}>
              采用
            </button>
            <button className={`trace-button trace-button-secondary ${candidateStatus === '已暂存' ? 'trace-button-selected' : ''}`} type="button" onClick={() => onCandidateAction('已暂存')}>
              暂存
            </button>
            <button className={`trace-button trace-button-quiet ${candidateStatus === '已拒绝' ? 'trace-button-selected' : ''}`} type="button" onClick={() => onCandidateAction('已拒绝')}>
              拒绝
            </button>
          </div>
        </div>
      </section>

      <p className="trace-footer-note">V1 Mock · 本页数据只保存在当前浏览器会话中</p>
    </aside>
  )
}
