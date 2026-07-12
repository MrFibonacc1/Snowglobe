import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Cameras } from './Cameras'
import type { Store } from '../store'

function store(overrides: Partial<Store> = {}): Store {
  return {
    cameras: [], events: [], connectCamera: vi.fn(), removeCamera: vi.fn(),
    pauseCamera: vi.fn(), resumeCamera: vi.fn(), ...overrides,
  } as unknown as Store
}

describe('Cameras', () => {
  it('shows an actionable empty state', () => {
    render(<Cameras store={store()} />)

    expect(screen.getByText('0 connected')).toBeInTheDocument()
    expect(screen.getByText(/No cameras yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connect camera/i })).toBeEnabled()
  })

  it('renders the state of a connected camera', () => {
    render(<Cameras store={store({
      cameras: [{
        id: 'cam-1', name: 'Front shelf', zone: 'front_shelf', source: 'rtsp',
        status: 'offline', fps: 1, detects: [], eventsToday: 3,
      }],
    })} />)

    expect(screen.getByText('1 connected')).toBeInTheDocument()
    expect(screen.getByText('Front shelf')).toBeInTheDocument()
    expect(screen.getByText('3 events today')).toBeInTheDocument()
    expect(screen.getByText('Discover events')).toBeInTheDocument()
  })

  it('offers Night Owl screen capture as a camera source', () => {
    render(<Cameras store={store()} />)
    fireEvent.click(screen.getByRole('button', { name: /connect camera/i }))

    expect(screen.getByText('Night Owl Protect CMS')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Night Owl Protect CMS'))
    expect(screen.getByLabelText('Application name')).toHaveValue('Night Owl Protect CMS')
  })
})
