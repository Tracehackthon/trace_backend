export function normalizeDesktopPort(value, fallback = 4173) {
  if (value === undefined || value === null || value === '') return fallback
  const port = Number(value)
  return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : fallback
}
