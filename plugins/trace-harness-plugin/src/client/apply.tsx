import React from 'react'
import { TraceOverlay } from './TraceOverlay'
import styles from './style.css'

export const inject = ['slots']

export function apply(ctx: any) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  ctx.effect(() => {
    const styleId = 'dsh-trace-ui-v1'
    const style = document.createElement('style')
    style.dataset.pluginCss = styleId
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'trace-ui-v1 styles')

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'trace-ui-v1' },
    () => React.createElement(TraceOverlay),
  ))
}
