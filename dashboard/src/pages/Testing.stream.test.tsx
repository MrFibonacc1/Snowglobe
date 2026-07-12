import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveCameraStream } from './Testing'

describe('LiveCameraStream', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('displays MJPEG continuously and samples its current frame every 500ms', async () => {
    const frame = new Blob(['jpeg'], { type: 'image/jpeg' })
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(frame))
    const onFrame = vi.fn()

    render(<LiveCameraStream cameraId="cam_live" onFrame={onFrame} />)
    const image = screen.getByAltText('live camera preview') as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { value: 1280 })
    Object.defineProperty(image, 'naturalHeight', { value: 720 })

    await act(async () => vi.advanceTimersByTime(499))
    expect(onFrame).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))

    expect(image.src).toBe('http://localhost:8008/cameras/cam_live/stream.mjpg')
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1280, 720)
    expect(onFrame).toHaveBeenCalledWith(frame)
  })
})
