"""Step executor registry. Each executor is a sync function
(config: dict, event: dict) -> dict output; the engine runs it in a thread."""

from steps import composio_step, condition, h_agent, mcp_step, voice

_EXECUTORS = {
    "h_agent": h_agent.execute,
    "composio": composio_step.execute,
    "condition": condition.execute,
    "voice": voice.execute,
    "mcp": mcp_step.execute,
}


def execute_step(step_type: str, config: dict, event: dict) -> dict:
    if step_type not in _EXECUTORS:
        raise ValueError(f"unknown step type: {step_type}")
    return _EXECUTORS[step_type](config, event)
