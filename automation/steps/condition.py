"""Condition step — gate a run on the triggering event.

config: { "expression": "payload.count > 20" }
Grammar: <event-path> <op> <literal>, ops: > < >= <= == !=
No eval(); a missing path simply fails the condition.
"""

import json
import re

_EXPR_RE = re.compile(r"^\s*([a-zA-Z0-9_.]+)\s*(>=|<=|==|!=|>|<)\s*(.+?)\s*$")

_OPS = {
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


def execute(config: dict, event: dict) -> dict:
    expression = config.get("expression", "")
    m = _EXPR_RE.match(expression)
    if not m:
        raise ValueError(f"bad condition expression: {expression!r}")
    path, op, literal_raw = m.groups()

    value = event
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return {"passed": False, "reason": f"path {path} missing"}
        value = value[part]

    try:
        literal = json.loads(literal_raw)
    except json.JSONDecodeError:
        literal = literal_raw.strip("'\"")

    try:
        passed = bool(_OPS[op](value, literal))
    except TypeError:
        return {"passed": False, "reason": f"type mismatch: {value!r} {op} {literal!r}"}
    return {"passed": passed, "value": value, "expression": expression}
