#!/usr/bin/env python3
"""Visitor-audit link checker.

Extract every navigational link from a live page or local Markdown/HTML file,
resolve it against the real publish root, follow redirects, and report a counted
per-link result. The implementation is Python-stdlib only.
"""

from __future__ import annotations

import argparse
import html.parser
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


USER_AGENT = {"User-Agent": "Mozilla/5.0 (visitor-audit link checker/1.0)"}
MARKDOWN_LINK = re.compile(
    r"(?<!!)\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+(?:\([^()]*\)[^()\s]*)*)"
)
SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "data:", "#")
GET_FALLBACK_STATUSES = {0, 403, 405, 501}


class LinkParser(html.parser.HTMLParser):
    """Collect navigational links and page-loaded assets from rendered HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attribute = "href" if tag in {"a", "area", "link"} else "src" if tag in {
            "img",
            "script",
            "iframe",
            "source",
        } else None
        if not attribute:
            return
        for key, value in attrs:
            if key == attribute and value:
                self.links.append(value)


def extract_links(text: str, is_html: bool) -> list[str]:
    """Extract, normalize, filter, and deduplicate links in source order."""
    if is_html:
        parser = LinkParser()
        parser.feed(text)
        raw = parser.links
    else:
        raw = [match.strip("<>") for match in MARKDOWN_LINK.findall(text)]

    seen: set[str] = set()
    links: list[str] = []
    for value in raw:
        href = value.strip()
        if not href or href.lower().startswith(SKIP_SCHEMES) or href in seen:
            continue
        seen.add(href)
        links.append(href)
    return links


def fetch(url: str, method: str = "GET", timeout: float = 20) -> tuple[int, str, str | None, str | None]:
    """Return status, final URL, decoded body, and error; redirects are followed."""
    request = urllib.request.Request(url, headers=USER_AGENT, method=method)
    try:
        with urllib.request.urlopen(
            request, timeout=timeout, context=ssl.create_default_context()
        ) as response:
            body = response.read().decode("utf-8", "replace") if method == "GET" else None
            return response.status, response.geturl(), body, None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.geturl(), None, str(exc)
    except Exception as exc:  # network/SSL failures must become evidence, not crashes
        return 0, url, None, f"{type(exc).__name__}: {exc}"


def check_http(href: str, base: str | None, timeout: float, retry_delay: float) -> dict[str, object]:
    url = urllib.parse.urljoin(base, href) if base else href
    if not url.startswith(("http://", "https://")):
        return {"href": href, "url": url, "status": 0, "note": "unresolvable (no URL base)"}

    status, final_url, _body, error = fetch(url, method="HEAD", timeout=timeout)
    if status in GET_FALLBACK_STATUSES:
        status, final_url, _body, error = fetch(url, method="GET", timeout=timeout)
    if status == 429:
        time.sleep(retry_delay)
        status, final_url, _body, error = fetch(url, method="GET", timeout=timeout)

    note = error if status == 0 else "rate-limited, unconfirmed" if status == 429 else ""
    return {"href": href, "url": final_url, "status": status, "note": note}


def check_file(href: str, root: Path) -> dict[str, object]:
    relative = urllib.parse.unquote(href.split("#", 1)[0])
    target = (root / relative).resolve()
    exists = target.exists()
    return {
        "href": href,
        "url": str(target),
        "status": 200 if exists else 404,
        "note": "local file" if exists else "local file missing",
    }


def self_test() -> None:
    markdown = (
        "See [docs](docs/manual.md), [site](https://x.invalid/p), "
        "![image](a.png), [mail](mailto:x@y), [anchor](#top)."
    )
    assert extract_links(markdown, is_html=False) == [
        "docs/manual.md",
        "https://x.invalid/p",
    ]
    html = (
        '<a href="/a">A</a> <a href="https://b.invalid/d">B</a> '
        '<img src="asset.png"> <a href="#fragment">fragment</a>'
    )
    assert extract_links(html, is_html=True) == [
        "/a",
        "https://b.invalid/d",
        "asset.png",
    ]
    assert urllib.parse.urljoin(
        "https://user.github.io/project/", "../SECURITY.md"
    ) == "https://user.github.io/SECURITY.md"
    print("self-test OK")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", help="live URL or local Markdown/HTML file")
    parser.add_argument("--base", help="actual published URL root or local filesystem root")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--self-test", action="store_true", help="run offline regression checks")
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--retry-delay", type=float, default=1.0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if not args.self_test and not args.source:
        parser.error("source required")
    return args


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0

    source = args.source
    assert source is not None
    local_root: Path | None = None
    if source.startswith(("http://", "https://")):
        status, final_url, text, error = fetch(source, method="GET", timeout=args.timeout)
        if status != 200 or text is None:
            print(f"FATAL: source fetch failed: {status} {source} {error or ''}".rstrip(), file=sys.stderr)
            return 2
        is_html = True
        base = args.base or final_url
    else:
        source_path = Path(source).resolve()
        text = source_path.read_text(encoding="utf-8")
        is_html = source_path.suffix.lower() in {".html", ".htm"}
        if args.base and urllib.parse.urlparse(args.base).scheme in {"http", "https"}:
            base = args.base.rstrip("/") + "/"
        else:
            base = None
            local_root = Path(args.base).resolve() if args.base else source_path.parent

    links = extract_links(text, is_html=is_html)

    def check(href: str) -> dict[str, object]:
        if href.startswith(("http://", "https://")) or base:
            return check_http(href, base, args.timeout, args.retry_delay)
        assert local_root is not None
        return check_file(href, local_root)

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        results = list(executor.map(check, links))

    ok = sum(1 for result in results if result["status"] == 200)
    rate_limited = sum(1 for result in results if result["status"] == 429)
    broken = len(results) - ok - rate_limited
    payload = {
        "source": source,
        "links_checked": len(results),
        "ok": ok,
        "broken": broken,
        "rate_limited": rate_limited,
        "results": results,
    }

    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        for result in sorted(results, key=lambda item: item["status"] == 200):
            status = result["status"]
            mark = "OK " if status == 200 else "?? " if status == 429 else "BAD"
            extra = f"  ({result['note']})" if result["note"] else ""
            print(f"{mark} {status:>3}  {result['url']}  <- {result['href']}{extra}")
        print(
            f"\n{len(results)} links checked, {ok} OK, {broken} broken, "
            f"{rate_limited} rate-limited (unconfirmed)"
        )
    return 0 if broken == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
