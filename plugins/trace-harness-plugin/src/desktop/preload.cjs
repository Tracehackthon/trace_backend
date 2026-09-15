const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('traceNative', {
  setIgnoreMouseEvents(ignore) {
    ipcRenderer.send('trace-native:set-ignore-mouse-events', ignore === true)
  },
  openDiscussion(url) {
    if (typeof url === 'string') ipcRenderer.send('trace-native:open-discussion', url)
  },
  onCandidate(listener) {
    if (typeof listener !== 'function') return undefined
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('trace-native:candidate', wrapped)
    return () => ipcRenderer.removeListener('trace-native:candidate', wrapped)
  },
})
