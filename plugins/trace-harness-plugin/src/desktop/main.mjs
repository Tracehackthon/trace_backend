import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const discussionOrigin = 'http://127.0.0.1:4173'
const allowedDiscussionKeys = new Set(['from', 'observationId', 'text', 'status', 'source'])

let overlayWindow
let tray
let quitting = false
const discussionWindows = new Set()

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  overlayWindow.setBounds({ x, y, width, height })
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  positionOverlay()
  overlayWindow.showInactive()
}

function toggleOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (overlayWindow.isVisible()) overlayWindow.hide()
  else showOverlay()
}

function parseDiscussionQuery(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }
  if (url.origin !== discussionOrigin) return undefined

  const query = {}
  for (const [key, value] of url.searchParams) {
    if (allowedDiscussionKeys.has(key)) query[key] = value
  }
  query.from = 'trace-native'
  return query
}

function openDiscussion(rawUrl) {
  const query = parseDiscussionQuery(rawUrl)
  if (!query) return

  const workArea = screen.getPrimaryDisplay().workArea
  const discussionWindow = new BrowserWindow({
    width: Math.min(1440, workArea.width),
    height: Math.min(900, workArea.height),
    minWidth: 880,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f0e7',
    title: 'Trace · 深度讨论',
    webPreferences: {
      preload: join(root, 'discussion-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  discussionWindows.add(discussionWindow)
  discussionWindow.once('ready-to-show', () => discussionWindow.show())
  discussionWindow.on('closed', () => discussionWindows.delete(discussionWindow))
  discussionWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void discussionWindow.loadFile(join(root, 'discussion', 'index.html'), { query })
}

function createOverlayWindow() {
  const workArea = screen.getPrimaryDisplay().workArea
  overlayWindow = new BrowserWindow({
    ...workArea,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Trace 桌面插件',
    webPreferences: {
      preload: join(root, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  overlayWindow.setAlwaysOnTop(true, 'floating')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  overlayWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    overlayWindow.hide()
  })
  overlayWindow.once('ready-to-show', showOverlay)
  overlayWindow.webContents.setWindowOpenHandler(({ url }) => {
    openDiscussion(url)
    return { action: 'deny' }
  })
  void overlayWindow.loadFile(join(root, 'index.html'))
}

function createTray() {
  const icon = nativeImage.createFromPath(join(root, 'liukanshan.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('Trace 桌面插件')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 Trace', click: showOverlay },
    { label: '隐藏 Trace', click: () => overlayWindow?.hide() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', toggleOverlay)
}

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
} else {
  app.on('second-instance', showOverlay)
  app.whenReady().then(() => {
    app.setAppUserModelId('cn.trace.native-plugin')
    Menu.setApplicationMenu(null)
    createOverlayWindow()
    createTray()

    screen.on('display-metrics-changed', positionOverlay)
    screen.on('display-added', positionOverlay)
    screen.on('display-removed', positionOverlay)
  })
}

ipcMain.on('trace-native:set-ignore-mouse-events', (event, ignore) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof ignore !== 'boolean') return
  overlayWindow.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.on('trace-native:open-discussion', (event, url) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof url !== 'string') return
  openDiscussion(url)
})

ipcMain.on('trace-native:discussion-candidate', (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow || !discussionWindows.has(senderWindow)) return
  if (!payload || payload.type !== 'trace.desktop.candidate') return
  if (typeof payload.observationId !== 'string' || !['候选中', '待确认'].includes(payload.status)) return
  overlayWindow?.webContents.send('trace-native:candidate', payload)
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  quitting = true
})
