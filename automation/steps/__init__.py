"""Step executor registry. Each executor is a sync function
(config: dict, event: dict, progress: callable | None) -> dict output; the
engine runs it in a thread. `progress` lets long-running steps (the H agent)
publish partial output — e.g. the live agent_view_url — while still running, so
the dashboard can show the agent working before the step finishes."""

from steps import composio_step, condition, h_agent, inventory, mcp_step, voice

_EXECUTORS = {
    "h_agent": h_agent.execute,
    "composio": composio_step.execute,
    "condition": condition.execute,
    "voice": voice.execute,
    "mcp": mcp_step.execute,
    "inventory_adjust": inventory.execute,
}


def execute_step(step_type: str, config: dict, event: dict, progress=None) -> dict:
    if step_type not in _EXECUTORS:
        raise ValueError(f"unknown step type: {step_type}")
    fn = _EXECUTORS[step_type]
    # Only executors that opt in accept `progress`; keep the others simple.
    if step_type == "h_agent":
        return fn(config, event, progress=progress)
    return fn(config, event)
