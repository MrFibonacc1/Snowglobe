import { act, fireEvent, render, screen } from '@testing-library/react'
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

  it('positions normalized detection boxes over the contained video image', () => {
    render(
      <LiveCameraStream
        cameraId="cam_live"
        onFrame={vi.fn()}
        boxes={[{ box: [0.1, 0.2, 0.6, 0.8], label: 'person', confidence: 0.92 }]}
      />,
    )
    const image = screen.getByAltText('live camera preview') as HTMLImageElement
    Object.defineProperties(image, {
      naturalWidth: { value: 1280 },
      naturalHeight: { value: 720 },
      clientWidth: { value: 640 },
      clientHeight: { value: 360 },
    })
    fireEvent.load(image)

    const overlay = screen.getByTestId('live-detection-overlay')
    expect(overlay).toHaveStyle({ width: '640px', height: '360px' })
    expect(screen.getByText('person 92%').parentElement).toHaveStyle({
      left: '10%', top: '20%', width: '50%', height: '60%',
    })
  })
})
