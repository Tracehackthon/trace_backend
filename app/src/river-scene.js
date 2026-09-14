const birds = [
  { duration: 34, offset: .23, size: 86, phase: 1.2, alpha: .94, path: [[-.15, .73], [.30, .64], [.65, .92], [1.15, .75]] },
  { duration: 45, offset: .66, size: 38, phase: 3.1, alpha: .67, path: [[1.15, .18], [.78, .08], [.24, .08], [-.15, .22]] },
  { duration: 45, offset: .61, size: 28, phase: 1.7, alpha: .45, path: [[1.15, .16], [.78, .06], [.24, .07], [-.15, .20]] },
  { duration: 42, offset: .76, size: 56, phase: 4.2, alpha: .8, path: [[1.13, .82], [.63, .70], [.24, .85], [-.13, .70]] },
]

function pointOnPath(points, t) {
  const a = (1-t)**3, b = 3*(1-t)**2*t, c = 3*(1-t)*t*t, d = t**3
  return [a*points[0][0]+b*points[1][0]+c*points[2][0]+d*points[3][0], a*points[0][1]+b*points[1][1]+c*points[2][1]+d*points[3][1]]
}

function paintBird(ctx, x, y, size, flap, direction, alpha, bank) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(bank)
  ctx.scale(direction * size / 84, size / 84)
  ctx.globalAlpha = alpha
  const wingY = -10 - Math.sin(flap) * 31

  ctx.fillStyle = '#658e80'
  ctx.beginPath()
  ctx.moveTo(2, -3)
  ctx.bezierCurveTo(-5, wingY*.85, -11, wingY-10, -24, wingY-6)
  ctx.lineTo(-12, wingY*.35)
  ctx.lineTo(-10, 2)
  ctx.fill()

  ctx.fillStyle = '#284c40'
  ctx.beginPath()
  ctx.moveTo(-12, -2)
  ctx.lineTo(-42, 4)
  ctx.lineTo(-29, 9)
  ctx.lineTo(-43, 15)
  ctx.lineTo(-10, 6)
  ctx.fill()

  ctx.fillStyle = '#eff3e8'
  ctx.beginPath()
  ctx.ellipse(-1, 1.5, 18, 7, -.1, 0, Math.PI*2)
  ctx.fill()
  ctx.fillStyle = '#346e58'
  ctx.beginPath()
  ctx.moveTo(-18, 1)
  ctx.bezierCurveTo(-10, -10, 6, -8, 17, -8)
  ctx.lineTo(12, 1)
  ctx.quadraticCurveTo(-3, 4, -18, 1)
  ctx.fill()

  // Jointed wing and separated primary feathers keep the flap readable at small sizes.
  ctx.fillStyle = '#234e3e'
  ctx.beginPath()
  ctx.moveTo(4, -3)
  ctx.quadraticCurveTo(-4, wingY*.42, -10, wingY)
  ctx.lineTo(-35, wingY-7)
  ctx.lineTo(-31, wingY+1)
  ctx.lineTo(-35, wingY+3)
  ctx.lineTo(-26, wingY+6)
  ctx.lineTo(-29, wingY+8)
  ctx.lineTo(-19, wingY+10)
  ctx.quadraticCurveTo(-13, 5, 0, 4)
  ctx.fill()
  ctx.strokeStyle = '#a7c5b4'
  ctx.lineWidth = .8
  ctx.beginPath()
  ctx.moveTo(0, -1)
  ctx.quadraticCurveTo(-12, wingY*.55, -29, wingY+1)
  ctx.stroke()

  ctx.fillStyle = '#1c3e31'
  ctx.beginPath()
  ctx.ellipse(15, -7, 7.5, 6, -.1, 0, Math.PI*2)
  ctx.fill()
  ctx.fillStyle = '#edf0dc'
  ctx.beginPath()
  ctx.moveTo(10, -4)
  ctx.quadraticCurveTo(16, 1, 22, -5)
  ctx.quadraticCurveTo(19, 6, 9, 6)
  ctx.fill()
  ctx.fillStyle = '#203a2d'
  ctx.beginPath()
  ctx.moveTo(21, -9)
  ctx.lineTo(31, -5)
  ctx.lineTo(21, -5)
  ctx.fill()
  ctx.fillStyle = '#f7f5dd'
  ctx.beginPath()
  ctx.arc(18, -9, 1.3, 0, Math.PI*2)
  ctx.fill()
  ctx.fillStyle = '#12251d'
  ctx.beginPath()
  ctx.arc(18.4, -9, .75, 0, Math.PI*2)
  ctx.fill()
  ctx.restore()
}

export function mountRiverScene(canvas, onPauseChange = () => {}) {
  const ctx = canvas.getContext('2d', { alpha: true })
  const control = new AbortController()
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const image = new Image()
  const buffer = document.createElement('canvas')
  const bufferCtx = buffer.getContext('2d')
  let width = 1, height = 1, ratio = 1, raf = 0, previous = 0, time = 0, renderedAt = 0
  let flightTop = 0, flightBottom = 0
  let paused = reducedMotion.matches, ready = false, destroyed = false

  if (!ctx || !bufferCtx) {
    onPauseChange(true)
    return { toggle() {}, destroy() {} }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect()
    width = Math.max(1, bounds.width)
    height = Math.max(1, bounds.height)
    const welcome = canvas.parentElement.querySelector('.auth-welcome').getBoundingClientRect()
    const journey = canvas.parentElement.querySelector('.auth-journey').getBoundingClientRect()
    flightTop = welcome.bottom-bounds.top+22
    flightBottom = Math.max(flightTop, journey.top-bounds.top-36)
    ratio = Math.min(devicePixelRatio || 1, width < 600 ? 1.5 : 2)
    canvas.width = buffer.width = Math.round(width*ratio)
    canvas.height = buffer.height = Math.round(height*ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    bufferCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (ready) {
      const scale = Math.max(width/image.width, height/image.height)
      bufferCtx.drawImage(image, (width-image.width*scale)/2, (height-image.height*scale)/2, image.width*scale, image.height*scale)
    }
    draw()
  }

  function draw() {
    ctx.clearRect(0, 0, width, height)
    if (ready) {
      ctx.drawImage(buffer, 0, 0, buffer.width, buffer.height, 0, 0, width, height)
      // Refract only the lower water surface; the image fallback remains visible while loading.
      for (let y = Math.floor(height*.57); y < height; y += 5) {
        const band = Math.min(5, height-y)
        const strength = (y/height-.57)*5
        const shift = Math.sin(y*.038-time*.7)*strength + Math.sin(y*.012+time*.45)*1.1
        ctx.drawImage(buffer, 0, y*ratio, buffer.width, band*ratio, -5+shift, y, width+10, band)
      }
    }

    const mobile = width < 600
    for (const bird of birds) {
      const u = (time/bird.duration+bird.offset)%1
      const [px, py] = pointOnPath(bird.path, u)
      const direction = bird.path[3][0] > bird.path[0][0] ? 1 : -1
      const lowFlight = bird.path[0][1] > .5
      const y = lowFlight ? flightTop + Math.min(1, Math.max(0, (py-.65)/.26))*(flightBottom-flightTop) : height*py
      const flap = time*7.8+bird.phase
      const amplitude = .25+.75*(.5+.5*Math.cos(time*.72+bird.phase))
      const pose = Math.asin(Math.sin(flap)*amplitude)
      paintBird(ctx, px*width, y+Math.sin(time*1.5+bird.phase)*2, bird.size*(mobile ? .68 : 1), pose, direction, bird.alpha, Math.sin(time*.65+bird.phase)*.08)
    }
  }

  function frame(now) {
    if (destroyed || paused || document.hidden) { raf = 0; return }
    if (previous) time += Math.min((now-previous)/1000, .1)
    previous = now
    if (now-renderedAt >= 32) { draw(); renderedAt = now }
    raf = requestAnimationFrame(frame)
  }

  function resume() {
    cancelAnimationFrame(raf)
    previous = 0
    raf = 0
    if (!paused && !document.hidden && !destroyed) raf = requestAnimationFrame(frame)
  }

  function setPaused(value) {
    paused = value
    canvas.dataset.paused = String(paused)
    onPauseChange(paused)
    resume()
    draw()
  }

  image.onload = () => { if (!destroyed) { ready = true; resize() } }
  image.src = './public/scenes/river.png'
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  observer.observe(canvas.parentElement.querySelector('.auth-welcome'))
  reducedMotion.addEventListener('change', event => setPaused(event.matches), { signal: control.signal })
  document.addEventListener('visibilitychange', resume, { signal: control.signal })
  resize()
  setPaused(paused)

  return {
    toggle() { setPaused(!paused) },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      control.abort()
      image.onload = null
    },
  }
}
