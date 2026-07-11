"""Tiny static file server so saved frames have a resolvable snapshot_url.

    python -m perception.snapshot_server            # serve repo root on :8001

With the default SNAPSHOT_BASE_URL of http://localhost:8001 and snapshots
written to ./snapshots/, an event's snapshot_url becomes
http://localhost:8001/snapshots/frame_....jpg — reachable by the dashboard
and by the H agent when it attaches evidence.
"""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class _Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow the dashboard (different origin) to load snapshots.
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, *args):  # quieter logs
        pass


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="perception.snapshot_server")
    p.add_argument("--port", type=int, default=8001)
    p.add_argument("--dir", default=".", help="directory to serve (default: repo root)")
    args = p.parse_args(argv)

    handler = partial(_Handler, directory=args.dir)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(f"snapshot server: serving {args.dir!r} on http://localhost:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
