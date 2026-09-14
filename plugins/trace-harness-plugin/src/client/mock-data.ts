export type ObservationStatus = '待确认' | '候选中' | '已采用' | '需回顾' | '已暂存' | '已拒绝'

export type CandidateStatus = '候选中' | '已采用' | '已暂存' | '已拒绝'

export type Observation = {
  id: string
  text: string
  status: ObservationStatus
  confidence: number
  source?: string
  createdAt: string
  isNew?: boolean
}

export const seedObservations: Observation[] = [
  {
    id: 'evidence-traceability',
    text: '检索结果必须附带可追溯证据',
    status: '待确认',
    confidence: 78,
    source: 'Cursor实验#18',
    createdAt: '刚刚',
  },
  {
    id: 'uncertainty-first',
    text: '复杂任务先显式陈述不确定性',
    status: '已采用',
    confidence: 91,
    createdAt: '昨天',
  },
  {
    id: 'decision-card-handoff',
    text: '多代交接以决策卡替代聊天摘要',
    status: '需回顾',
    confidence: 64,
    createdAt: '3天前',
  },
]

export const candidateJudgement = {
  id: 'candidate-01',
  title: '把“接住”放在分类之前，让思考先留下来',
  body: '先保存现场，再在需要查证、关联或持续追问时进入讨论。',
  confidence: 82,
  linkedObservationId: 'evidence-traceability',
}
