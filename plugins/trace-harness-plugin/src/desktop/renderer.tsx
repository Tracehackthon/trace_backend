import React from 'react'
import { createRoot } from 'react-dom/client'
import { TraceOverlay } from '../client/TraceOverlay'
import traceStyles from '../client/style.css'
import nativeStyles from './native.css'

type NativeBridge = {
  setIgnoreMouseEvents: (ignore: boolean) => void
}

const style = document.createElement('style')
style.dataset.pluginCss = 'trace-native-ui-v1'
style.textContent = `${traceStyles}\n${nativeStyles}`
document.head.appendChild(style)

const bridge = (window as Window & { traceNative?: NativeBridge }).traceNative
let ignoringMouseEvents = false

function setIgnoringMouseEvents(ignore: boolean) {
  if (!bridge || ignore === ignoringMouseEvents) return
  ignoringMouseEvents = ignore
  bridge.setIgnoreMouseEvents(ignore)
}

function updateMousePassthrough(event: MouseEvent) {
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const interactive = target instanceof Element && Boolean(target.closest(
    'button, input, textarea, select, a, [role="button"], .trace-detail-panel, .trace-reminder-bubble',
  ))
  setIgnoringMouseEvents(!interactive)
}

window.addEventListener('mousemove', updateMousePassthrough, { passive: true })
window.addEventListener('blur', () => setIgnoringMouseEvents(true))
document.documentElement.addEventListener('mouseleave', () => setIgnoringMouseEvents(true))
setIgnoringMouseEvents(true)

const root = document.querySelector('#trace-native-root')
if (!(root instanceof HTMLElement)) throw new Error('Trace native root is missing')

createRoot(root).render(React.createElement(TraceOverlay))
