const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('traceNative', {
  reportCandidate(payload) {
    ipcRenderer.send('trace-native:discussion-candidate', payload)
  },
})
