import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDesktopPort } from '../apps/desktop/runtime-port.mjs'

test('desktop runtime accepts port zero for OS-assigned loopback binding', () => {
  assert.equal(normalizeDesktopPort('0'), 0)
  assert.equal(normalizeDesktopPort(0), 0)
  assert.equal(normalizeDesktopPort('42731'), 42731)
})

test('desktop runtime rejects malformed and out-of-range ports', () => {
  assert.equal(normalizeDesktopPort(undefined), 4173)
  assert.equal(normalizeDesktopPort(''), 4173)
  assert.equal(normalizeDesktopPort('-1'), 4173)
  assert.equal(normalizeDesktopPort('65536'), 4173)
  assert.equal(normalizeDesktopPort('not-a-port'), 4173)
})
