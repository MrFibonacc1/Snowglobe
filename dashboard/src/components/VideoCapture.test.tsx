import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { VideoCapture } from './VideoCapture'
import type { Store } from '../store'

vi.mock('./LiveCameraStream', () => ({
  LiveCameraStream: ({ onFrame }: { onFrame: (blob: Blob) => void }) => (
    <img
      alt="mock live camera preview"
      onClick={() => onFrame(new Blob(['frame'], { type: 'image/jpeg' }))}
    />
  ),
}))

describe('VideoCapture live camera mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('displays MJPEG and continuously analyzes sampled stream frames', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ model: 'test', mock: false, events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const store = {
      cameras: [{
        id: 'cam_1', name: 'Night Owl', source: 'window:Night Owl', zone: 'shelf',
        fps: 1, events: [], mock: false, status: 'live', frames_sampled: 1,
        events_emitted: 0,
      }],
      ingestEvents: vi.fn(),
      refreshRuns: vi.fn(),
    } as unknown as Store
    const user = userEvent.setup()

    render(<VideoCapture store={store} onRunsStarted={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /start live/i }))
    expect(screen.getByRole('img', { name: /mock live camera preview/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('img', { name: /mock live camera preview/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toContain('/detect')
  })

  it('reports an upstream detection failure without claiming the service is offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'discover failed: upstream rejected request' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const store = {
      cameras: [{
        id: 'cam_1', name: 'Night Owl', source: 'window:Night Owl', zone: 'shelf',
        fps: 1, events: [], mock: false, status: 'live', frames_sampled: 1,
        events_emitted: 0,
      }],
      ingestEvents: vi.fn(), refreshRuns: vi.fn(),
    } as unknown as Store

    render(<VideoCapture store={store} onRunsStarted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /start live/i }))
    fireEvent.click(screen.getByRole('img', { name: /mock live camera preview/i }))

    expect(await screen.findByText(/upstream rejected request.*retrying/i)).toBeInTheDocument()
    expect(screen.queryByText(/could not reach the perception service/i)).not.toBeInTheDocument()
  })

  it('shows the browser webcam and begins analysis from one click', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ model: 'test', mock: false, events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['webcam'], { type: 'image/jpeg' }))
    })
    Object.defineProperties(HTMLVideoElement.prototype, {
      readyState: { configurable: true, get: () => 4 },
      videoWidth: { configurable: true, get: () => 640 },
      videoHeight: { configurable: true, get: () => 480 },
    })
    const store = {
      cameras: [], ingestEvents: vi.fn(), refreshRuns: vi.fn(),
    } as unknown as Store

    const { unmount } = render(
      <StrictMode>
        <VideoCapture store={store} onRunsStarted={vi.fn()} />
      </StrictMode>,
    )
    await userEvent.click(screen.getByRole('button', { name: /use my camera/i }))

    expect(await screen.findByTestId('browser-camera-preview')).toBeInTheDocument()
    expect(stop).not.toHaveBeenCalled()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toContain('/detect')
    unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('overlays whole-frame object detections on the browser webcam', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({
        model: 'test', mock: false, events: [], verdicts: [],
        objects: [{ phrase: 'person', confidence: 0.93, boxes: [[0.1, 0.2, 0.7, 0.9]] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['webcam'], { type: 'image/jpeg' }))
    })
    Object.defineProperties(HTMLVideoElement.prototype, {
      readyState: { configurable: true, get: () => 4 },
      videoWidth: { configurable: true, get: () => 640 },
      videoHeight: { configurable: true, get: () => 480 },
      clientWidth: { configurable: true, get: () => 640 },
      clientHeight: { configurable: true, get: () => 480 },
    })
    const store = { cameras: [], ingestEvents: vi.fn(), refreshRuns: vi.fn() } as unknown as Store

    render(<VideoCapture store={store} onRunsStarted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /use my camera/i }))

    expect(await screen.findByText('person 93%')).toBeInTheDocument()
  })
})
