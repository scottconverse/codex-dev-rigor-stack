#!/usr/bin/env python3
"""Extract Markdown/HTML links, resolve them, and report HTTP/file status as JSON."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+['\"][^'\"]*['\"])?\)")
HTML_LINK = re.compile(r"(?:href|src)\s*=\s*['\"]([^'\"]+)['\"]", re.IGNORECASE)


def extract(text: str) -> list[str]:
    return list(dict.fromkeys(MARKDOWN_LINK.findall(text) + HTML_LINK.findall(text)))


def check_http(url: str, timeout: float) -> dict[str, object]:
    request = urllib.request.Request(url, headers={"User-Agent": "visitor-audit/0.2"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return {"ok": response.status == 200, "status": response.status,
                    "final_url": response.geturl()}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "status": exc.code, "final_url": exc.geturl(),
                "error": str(exc)}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"ok": False, "status": None, "final_url": url, "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("surface", help="Markdown/HTML file to inspect")
    parser.add_argument("--base", help="Published base URL or filesystem root")
    parser.add_argument("--timeout", type=float, default=15)
    args = parser.parse_args()

    surface = Path(args.surface).resolve()
    links = extract(surface.read_text(encoding="utf-8"))
    results: list[dict[str, object]] = []
    for raw in links:
        if raw.startswith(("#", "mailto:", "tel:", "javascript:")):
            results.append({"link": raw, "ok": True, "status": "non-fetch"})
            continue
        if urllib.parse.urlparse(raw).scheme in {"http", "https"}:
            result = check_http(raw, args.timeout)
        elif args.base and urllib.parse.urlparse(args.base).scheme in {"http", "https"}:
            result = check_http(urllib.parse.urljoin(args.base.rstrip("/") + "/", raw), args.timeout)
        else:
            root = Path(args.base).resolve() if args.base else surface.parent
            target = (root / urllib.parse.unquote(raw.split("#", 1)[0])).resolve()
            result = {"ok": target.exists(), "status": "file", "final_url": str(target)}
        results.append({"link": raw, **result})

    payload = {"surface": str(surface), "links_checked": len(results), "results": results}
    json.dump(payload, sys.stdout, indent=2)
    print()
    return 0 if all(item["ok"] for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
