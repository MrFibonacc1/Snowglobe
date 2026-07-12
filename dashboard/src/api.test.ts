import { describe, expect, it } from 'vitest'
import { cameraStreamUrl } from './api'

describe('cameraStreamUrl', () => {
  it('uses one persistent MJPEG endpoint instead of cache-busted JPEG polling', () => {
    expect(cameraStreamUrl('cam_live')).toBe('http://localhost:8008/cameras/cam_live/stream.mjpg')
  })
})
