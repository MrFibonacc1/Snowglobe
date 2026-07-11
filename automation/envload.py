"""Load automation/.env (gitignored) into os.environ on import, without
overriding vars already set in the shell — same pattern perception/ uses.
Import this FIRST in entrypoints: step modules read env at import time.
"""

import os

_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_path):
    with open(_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())
