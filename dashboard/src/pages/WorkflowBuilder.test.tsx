import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowBuilder } from './WorkflowBuilder'
import type { Store } from '../store'

describe('WorkflowBuilder', () => {
  it('creates a workflow with a canonical discovery trigger', async () => {
    const saveWorkflow = vi.fn()
    const store = {
      workflows: [], backendOnline: true, saveWorkflow,
      testWorkflow: vi.fn(), toggleWorkflow: vi.fn(), removeWorkflow: vi.fn(),
    } as unknown as Store
    const user = userEvent.setup()

    render(<WorkflowBuilder store={store} />)
    await user.click(screen.getByRole('button', { name: /new workflow/i }))
    await user.type(screen.getByPlaceholderText('Workflow name'), 'Shelf stock update')
    const trigger = screen.getByPlaceholderText(/type a custom event/i)
    await user.clear(trigger)
    await user.type(trigger, 'item_removed_from_shelf')
    await user.click(screen.getByRole('button', { name: /create workflow/i }))

    expect(saveWorkflow).toHaveBeenCalledOnce()
    const [workflow, isNew] = saveWorkflow.mock.calls[0]
    expect(workflow.name).toBe('Shelf stock update')
    expect(workflow.trigger.event_type).toBe('item_removed_from_shelf')
    expect(workflow.steps).toHaveLength(1)
    expect(isNew).toBe(true)
  })
})
