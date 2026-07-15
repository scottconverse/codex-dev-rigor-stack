#!/usr/bin/env python3
"""Behavioral regression tests for the visitor-audit link checker."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECKERS = (
    ROOT / "skills" / "visitor-audit" / "scripts" / "check_links.py",
    ROOT / "skills" / "dev-rigor-stack-visitor-audit" / "scripts" / "check_links.py",
)


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    limited_requests = 0

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib callback name
        if self.path == "/missing.md":
            self.send_response(404)
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/ok")
        elif self.path == "/head-rejected":
            self.send_response(405)
        elif self.path == "/limited":
            type(self).limited_requests += 1
            self.send_response(429 if type(self).limited_requests == 1 else 200)
            self.send_header("Retry-After", "0")
        else:
            self.send_response(200)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
        if self.path == "/surface":
            body = (
                '<a href="/ok">OK</a>'
                '<a href="/redirect">redirect</a>'
                '<a href="/head-rejected">fallback</a>'
                '<a href="/limited">limited</a>'
                '<a href="#local">anchor</a>'
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/README.md":
            body = b"[working](target.md) [missing](missing.md) ![image](missing.png)"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/missing.md":
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.end_headers()


class VisitorAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def run_checker(self, checker: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(checker), *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )

    def test_self_test_is_available(self) -> None:
        for checker in CHECKERS:
            with self.subTest(checker=checker.parent.parent.name):
                result = self.run_checker(checker, "--self-test")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("self-test OK", result.stdout)

    def test_live_url_follows_redirects_falls_back_to_get_and_handles_429(self) -> None:
        for checker in CHECKERS:
            with self.subTest(checker=checker.parent.parent.name):
                FixtureHandler.limited_requests = 0
                result = self.run_checker(checker, f"{self.base}/surface", "--json")
                self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                payload = json.loads(result.stdout)
                self.assertEqual(payload["links_checked"], 4)
                self.assertEqual(payload["broken"], 0)
                self.assertTrue(all(item["status"] == 200 for item in payload["results"]))

    def test_markdown_skips_images_anchors_and_mail_links(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "target.md").write_text("target", encoding="utf-8")
            source = root / "README.md"
            source.write_text(
                "[target](target.md) ![image](missing.png) "
                "[anchor](#top) [mail](mailto:test@example.com)",
                encoding="utf-8",
            )
            for checker in CHECKERS:
                with self.subTest(checker=checker.parent.parent.name):
                    result = self.run_checker(checker, str(source), "--json")
                    self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                    payload = json.loads(result.stdout)
                    self.assertEqual(payload["links_checked"], 1)
                    self.assertEqual(payload["broken"], 0)

    def test_remote_markdown_is_parsed_as_markdown(self) -> None:
        for checker in CHECKERS:
            with self.subTest(checker=checker.parent.parent.name):
                result = self.run_checker(checker, f"{self.base}/README.md", "--json")
                self.assertEqual(result.returncode, 1, result.stderr or result.stdout)
                payload = json.loads(result.stdout)
                self.assertEqual(payload["links_checked"], 2)
                self.assertEqual(payload["ok"], 1)
                self.assertEqual(payload["broken"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
