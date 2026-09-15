export const MODES = ['overview', 'thinking', 'growth', 'work', 'return']
export function routeFor(search = '') {
  const p = new URLSearchParams(search)
  if (p.get('view') === 'home') return 'home'
  if (p.get('view') === 'matters') return 'matters'
  return p.get('view') === 'discussion' || ['from', 'observationId', 'text', 'status', 'source'].some(k => p.has(k)) ? 'discussion' : 'home'
}
export const ENTRIES = {
  thought: { title: '收藏后为什么接不回来', subtitle: '上次停在：个人表达，还是原文现场？', icon: 'file' },
  work: { title: '工作 UI 如何承接', subtitle: 'Codex · harness · 刚有新变化', icon: 'box', warm: true },
  fresh: { title: '想重新看，不先被旧理解带走', subtitle: '一段新的感受刚刚出现', icon: 'file' },
  handoff: { title: '多 Agent 交接如何保留证据', subtitle: '还有一个判断等待验证', icon: 'message' },
  insight: { title: '再次出现的理由，可能比分类更重要。', subtitle: '刚刚形成', icon: 'file', warm: true },
  practice: { title: 'Codex · harness', subtitle: '实践完成', icon: 'box', warm: true },
  result: { title: '气泡原位展开，更能保留接续感。', subtitle: '它让用户始终看见这段思考从哪里被重新拿起。', icon: 'check', warm: true },
}
export function createState(mode = 'overview') {
  return { mode: MODES.includes(mode) ? mode : 'overview', active: 'thought', captured: '', insight: '', result: '', sampleResult: true }
}
export function transition(state, action) {
  switch (action.type) {
    case 'OPEN': return { ...state, mode: action.id === 'work' || action.id === 'practice' ? 'work' : action.id === 'result' ? 'return' : 'thinking', active: action.id }
    case 'CLOSE': return { ...state, mode: 'overview' }
    case 'CAPTURE': return action.text.trim() ? { ...state, mode: 'thinking', active: 'thought', captured: action.text.trim() } : state
    case 'GROW': return { ...state, mode: 'growth', insight: action.text?.trim() || ENTRIES.insight.title }
    case 'WORK': return { ...state, mode: 'work', active: 'work' }
    case 'RETURN': return action.text?.trim() ? { ...state, mode: 'return', result: action.text.trim(), sampleResult: false } : state
    case 'SAMPLE_RETURN': return { ...state, mode: 'return', result: '', sampleResult: true }
    case 'MODE': return { ...state, mode: MODES.includes(action.mode) ? action.mode : 'overview' }
    default: return state
  }
}
// Scene coordinates are measured against the six approved 1672 × 941 images.
export const LAYOUTS = {
  overview: { thought: [142, 546, 435, 141], work: [840, 655, 330, 120], fresh: [1312, 432, 314, 115], handoff: [1252, 665, 322, 120] },
  thinking: { thought: [106, 556, 327, 112], work: [850, 700, 320, 114], fresh: [1312, 432, 314, 115], handoff: [1285, 666, 300, 109] },
  growth: { thought: [142, 540, 433, 142], work: [853, 700, 323, 113], fresh: [1312, 432, 314, 115], handoff: [1253, 697, 322, 115], insight: [850, 513, 447, 123] },
  work: { thought: [57, 442, 341, 117], fresh: [1314, 339, 311, 115], handoff: [1307, 652, 294, 116] },
  return: { thought: [158, 647, 330, 105], work: [109, 473, 319, 148], fresh: [1369, 387, 284, 104], handoff: [1337, 728, 304, 108], practice: [522, 568, 239, 100], result: [927, 482, 520, 267] },
}
export const BIRDS = { overview: [389, 355], thinking: [449, 326], growth: [801, 467], work: [818, 311], return: [1145, 441] }
export const PATHS = {
  overview: [
    'M -10 385 C 148 390 216 518 360 545 C 462 477 611 568 754 503',
    'M 286 509 C 369 508 392 434 443 407 C 462 466 583 539 754 503',
    'M 754 503 C 787 585 824 626 976 660',
    'M 754 503 C 869 582 1019 550 1156 529 C 1249 516 1261 460 1332 454',
    'M 754 503 C 897 567 987 530 1055 586 C 1163 698 1237 615 1332 662',
  ],
  thinking: [
    'M -10 387 C 130 402 244 532 323 545 C 411 558 443 381 521 379',
    'M 281 502 C 357 506 421 402 521 379',
    'M 754 503 C 800 586 840 623 978 710',
    'M 754 503 C 1039 572 1245 457 1332 454',
    'M 754 503 C 912 567 1127 579 1352 663',
  ],
  growth: [
    'M -10 385 C 158 404 217 507 360 538 C 541 487 618 648 867 521',
    'M 283 504 C 366 503 384 428 441 407 C 466 486 620 526 754 519',
    'M 867 521 C 784 614 859 620 975 701',
    'M 867 521 C 1020 557 1161 516 1332 454',
    'M 867 521 C 1024 579 1048 752 1332 692',
  ],
  work: [
    'M -10 386 C 124 408 218 446 283 445 C 424 414 485 253 741 321',
    'M 283 445 C 352 449 372 354 428 341 C 510 331 569 438 741 321',
    'M 741 321 C 830 407 833 333 895 341',
    'M 741 321 C 965 365 1164 310 1332 363',
    'M 741 321 C 833 466 1193 600 1384 650',
  ],
  return: [
    'M -10 386 C 89 402 173 441 250 455 C 415 362 499 448 630 562 C 803 611 956 445 1056 479',
    'M 250 455 C 392 489 446 542 630 562',
    'M 630 562 C 804 462 942 588 1056 479',
    'M 1056 479 C 1179 473 1274 463 1390 395',
    'M 1056 479 C 1209 526 1404 667 1536 727',
  ],
}
export const NODE_POSITIONS = {
  overview: [[360,545],[443,407],[754,503],[976,660],[1332,454],[1332,662]],
  thinking: [[323,545],[521,379],[754,503],[978,710],[1332,454],[1352,663]],
  growth: [[360,538],[441,407],[867,521],[975,701],[1332,454],[1332,692]],
  work: [[283,445],[428,341],[741,321],[895,341],[1332,363],[1384,650]],
  return: [[250,455],[316,650],[630,562],[1056,479],[1390,395],[1536,727]],
}
