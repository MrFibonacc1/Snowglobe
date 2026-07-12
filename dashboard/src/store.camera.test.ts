import { describe, expect, it } from 'vitest'
import { isBackendCameraId } from './store'

describe('isBackendCameraId', () => {
  it('identifies ephemeral backend camera IDs without matching seeded cameras', () => {
    expect(isBackendCameraId('cam_08f7452f')).toBe(true)
    expect(isBackendCameraId('cam_lobby')).toBe(false)
    expect(isBackendCameraId('cam_local_custom')).toBe(false)
  })
})
