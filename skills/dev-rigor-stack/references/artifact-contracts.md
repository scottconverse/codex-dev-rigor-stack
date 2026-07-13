# Dev Rigor Stack artifact contracts

Use these filenames and minimum fields so every standalone stage can hand evidence to
the next without reinterpretation. JSON artifacts supplement the human report; they do
not replace screenshots, traces, logs, commands, or other raw evidence.

## `run-manifest.json`

```json
{
  "schema_version": "1.0",
  "run_id": "unique-id",
  "stage": "plan|build|proof|review|walkthrough|visitor|merge|docs|release",
  "mode": "scoped|candidate|published|full",
  "project": "name",
  "commit": "sha-or-null",
  "artifact_ids": ["hash-or-release-asset-id"],
  "platform_scope": ["os/arch/version"],
  "started_at": "ISO-8601",
  "environment_artifacts": ["path"]
}
```

## `claims.json`

```json
{
  "claims": [
    {
      "id": "CLAIM-001",
      "source": "URL/file/screen",
      "claim": "observable promise",
      "status": "survived|refuted|untested|unverifiable",
      "evidence": ["artifact/path"]
    }
  ]
}
```

## `findings.json`

```json
{
  "findings": [
    {
      "id": "FINDING-001",
      "stage": "walkthrough",
      "location": "screen/route/file",
      "severity": "Blocker|Critical|Major|Minor|Nit",
      "confirmed": true,
      "expected": "expected behavior",
      "actual": "observed behavior",
      "reproduction": ["step"],
      "evidence": ["artifact/path"],
      "suggested_fix": "fix path",
      "suggested_test": "regression test"
    }
  ]
}
```

## `coverage-ledger.json`

```json
{
  "coverage_valid": true,
  "invalid_reasons": [],
  "dimensions": {
    "screens": {"inventoried": 0, "tested": 0, "failed": 0, "blocked": 0, "excluded": 0},
    "controls": {"inventoried": 0, "tested": 0, "failed": 0, "blocked": 0, "excluded": 0},
    "paths": {"inventoried": 0, "tested": 0, "failed": 0, "blocked": 0, "excluded": 0},
    "visual_states": {"inventoried": 0, "tested": 0, "failed": 0, "blocked": 0, "excluded": 0},
    "public_surfaces": {"inventoried": 0, "tested": 0, "failed": 0, "blocked": 0, "excluded": 0},
    "links": {"inventoried": 0, "tested": 0, "failed": 0, "blocked": 0, "excluded": 0}
  },
  "items": [
    {"id": "SCREEN-001", "result": "passed|failed|blocked|unverifiable|excluded", "reason": "", "evidence": ["path"]}
  ]
}
```

For every dimension: `inventoried == tested + blocked + excluded + unverifiable` after
failed items are included in tested. A missing denominator, unmatched item, contaminated
blind pass, or absent required artifact makes `coverage_valid` false.

## `handoff.json`

```json
{
  "from_stage": "visitor",
  "to_stage": "walkthrough",
  "run_id": "source-run",
  "commit": "sha-or-null",
  "artifact_ids": ["hash"],
  "inputs": {"installer_url": "https://...", "checksum": "..."},
  "open_findings": ["FINDING-001"],
  "unproven": [],
  "evidence": ["path"]
}
```

The receiving stage verifies commit/artifact identity and refuses stale or mismatched
evidence. It may add evidence; it may not rewrite the upstream record.

## `gate-result.json`

```json
{
  "stage": "release",
  "verdict": "PASS|FAIL|INVALID|BLOCKED|PARTIAL",
  "strict_zero": true,
  "severity": {"Blocker": 0, "Critical": 0, "Major": 0, "Minor": 0, "Nit": 0},
  "coverage_valid": true,
  "run_ids": ["input-run"],
  "blocking_findings": [],
  "evidence": ["path"]
}
```

PASS requires strict-zero, valid coverage, exact artifact identity, and every mandatory
stage for the selected scope. Missing/blocked coverage is not PASS.
