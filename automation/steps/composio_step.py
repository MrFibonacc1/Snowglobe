"""Composio step — API-shaped actions (Drive, Sheets, Slack).

With COMPOSIO_API_KEY set (and `pip install composio`), executes the real
action via Composio's SDK. Without it, stubs: logs the payload and returns
{"stubbed": true} so demos never hard-block on account connections.

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

_USER_ID = os.environ.get("COMPOSIO_USER_ID", "default")


def execute(config: dict, event: dict) -> dict:
    action = config.get("action")
    if action not in _SLUGS:
        raise ValueError(f"unknown composio action: {action}")

    arguments = _build_arguments(action, config)
    api_key = os.environ.get("COMPOSIO_API_KEY")
    if not api_key:
        print(f"[composio stub] {action}: {arguments}")
        return {"stubbed": True, "action": action, "arguments": arguments}

    from composio import Composio  # lazy: optional dependency

    client = Composio(api_key=api_key)
    result = client.tools.execute(
        slug=_SLUGS[action],
        user_id=_USER_ID,
        arguments=arguments,
    )
    return {"stubbed": False, "action": action, "result": _summarize(result)}


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
    if isinstance(result, dict):
        return {
            "successful": result.get("successful", result.get("success")),
            "data_keys": sorted(result.get("data", {}).keys())[:10]
            if isinstance(result.get("data"), dict)
            else None,
        }
    return {"raw": str(result)[:300]}
