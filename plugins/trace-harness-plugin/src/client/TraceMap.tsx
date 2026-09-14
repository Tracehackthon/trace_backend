import React from 'react'

const nodes = [
  { id: 'current', label: '当前观察', x: 28, y: 24, tone: 'current' },
  { id: 'raw', label: '原始现场', x: 8, y: 70, tone: 'raw' },
  { id: 'history', label: '历史线索', x: 48, y: 72, tone: 'history' },
  { id: 'zhihu', label: '知乎前例', x: 72, y: 26, tone: 'zhihu' },
  { id: 'candidate', label: '候选判断', x: 86, y: 72, tone: 'candidate' },
]

const edges = [
  ['current', 'raw'],
  ['current', 'history'],
  ['current', 'zhihu'],
  ['history', 'candidate'],
  ['zhihu', 'candidate'],
]

export function TraceMap() {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
  return (
    <section className="trace-section trace-map-section" aria-labelledby="trace-map-title">
      <div className="trace-section-heading">
        <div>
          <span className="trace-eyebrow">思考路径</span>
          <h3 id="trace-map-title">非线性思考图</h3>
        </div>
        <span className="trace-static-badge">静态 V1</span>
      </div>
      <div className="trace-map" role="img" aria-label="当前观察与原始现场、历史线索、知乎前例、候选判断的关系图">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {edges.map(([from, to]) => {
            const start = byId[from]
            const end = byId[to]
            return <line key={`${from}-${to}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
        </svg>
        {nodes.map((node) => (
          <span
            key={node.id}
            className={`trace-map-node trace-map-node-${node.tone}`}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            {node.label}
          </span>
        ))}
      </div>
    </section>
  )
}
