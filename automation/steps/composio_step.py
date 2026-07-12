"""Composio step — API-shaped actions (Drive, Sheets, Slack).

With COMPOSIO_API_KEY set (and `pip install composio`), executes the real
action via Composio's SDK. It fails closed when credentials, execution rights,
or linked accounts are missing: a workflow may never claim an external action
completed when nothing was sent.

Setup (full walkthrough in automation/NOTES.md):
  pip install composio
  composio login                                   # or set COMPOSIO_API_KEY
  composio connected-accounts link slack           # once per toolkit
  composio connected-accounts link googledrive
  composio connected-accounts link googlesheets

config: { "action": "slack_message" | "drive_upload" | "sheets_append",
          ...action params (templated) }
"""

import os

# Action slugs verified against docs.composio.dev toolkits. If one 404s,
# check the current name with:  composio tools info <slug-guess>
_SLUGS = {
    "slack_message": "SLACK_SEND_MESSAGE",
    "drive_upload": "GOOGLEDRIVE_UPLOAD_FILE",
    "sheets_append": "GOOGLESHEETS_BATCH_UPDATE",
}


class ComposioExecutionError(RuntimeError):
    """The requested external action was not confirmed as executed."""


def _create_client(api_key: str):
    from composio import Composio  # lazy: optional dependency

    return Composio(api_key=api_key)


def execute(config: dict, event: dict) -> dict:
    action = config.get("action")
    if action not in _SLUGS:
        raise ValueError(f"unknown composio action: {action}")

    arguments = _build_arguments(action, config)
    api_key = os.environ.get("COMPOSIO_API_KEY")
    if not api_key:
        raise ComposioExecutionError(
            "Composio is not configured: COMPOSIO_API_KEY is missing; action was not sent"
        )

    client = _create_client(api_key)
    # SDK 0.17+ requires an explicit toolkit version for manual execution;
    # skip the check so we always run against the latest.
    try:
        result = client.tools.execute(
            slug=_SLUGS[action],
            user_id=os.environ.get("COMPOSIO_USER_ID", "default"),
            arguments=arguments,
            dangerously_skip_version_check=True,
        )
    except Exception as exc:  # noqa: BLE001
        reason = _degradable_reason(str(exc))
        if reason:
            raise ComposioExecutionError(
                f"Composio {action} not executed: {reason}"
            ) from exc
        raise

    summary = _summarize(result)
    if summary.get("successful") is not True:
        error = _result_value(result, "error") or "Composio did not confirm success"
        raise ComposioExecutionError(f"Composio {action} not executed: {error}")
    return {"executed": True, "action": action, "result": summary}


def _degradable_reason(err: str) -> str | None:
    """Map a Composio error to a short reason if it's a 'not configured yet'
    condition we should skip past; otherwise None (caller re-raises)."""
    low = err.lower()
    if "invalid api key" in low or "401" in low or "unauthorized" in low:
        return "key lacks tool-execution rights (401) — needs an execution-enabled key"
    if "no connected account" in low or "not connected" in low or "connection" in low:
        return "no connected account for this toolkit — link it (see NOTES.md)"
    return None


def _build_arguments(action: str, config: dict) -> dict:
    if action == "slack_message":
        return {"channel": config["channel"], "text": config["text"]}
    if action == "drive_upload":
        # file: local path (from perception's snapshots) or URL.
        # Param names per GOOGLEDRIVE_UPLOAD_FILE schema; verify with
        # `composio tools info GOOGLEDRIVE_UPLOAD_FILE` after linking.
        return {
            "file_to_upload": config["file"],
            "folder_to_upload_to": config.get("folder", ""),
        }
    if action == "sheets_append":
        return {
            "spreadsheet_id": config["spreadsheet_id"],
            "sheet_name": config.get("sheet_name", "Sheet1"),
            "values": config["values"],  # list of rows
        }
    raise ValueError(action)


def _summarize(result) -> dict:
    # Composio responses can be large; keep what the runs view needs.
    if not isinstance(result, dict) and hasattr(result, "model_dump"):
        result = result.model_dump()
    if isinstance(result, dict):
        return {
            "successful": result.get("successful", result.get("success")),
            "data_keys": sorted(result.get("data", {}).keys())[:10]
            if isinstance(result.get("data"), dict)
            else None,
        }
    return {"raw": str(result)[:300]}


def _result_value(result, key: str):
    if isinstance(result, dict):
        return result.get(key)
    return getattr(result, key, None)
