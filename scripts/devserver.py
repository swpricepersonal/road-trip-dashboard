"""Static file server for local dev/preview that disables caching.

python -m http.server sends no Cache-Control header, so browsers apply
heuristic caching to JS modules — edits can silently fail to show up across
reloads (cost real debugging time once already; see ARCHITECTURE.md's
"Deploy caching gotcha" for the equivalent GitHub Pages issue). This wrapper
just adds Cache-Control: no-store to every response.
"""

import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    http.server.test(HandlerClass=NoCacheHandler, port=PORT, bind="127.0.0.1")
