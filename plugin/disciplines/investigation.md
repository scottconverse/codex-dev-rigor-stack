RIGOR ROUTER — INVESTIGATION PROTOCOL matched for this task. (If this prompt isn't asking for code work, ignore this note.)

This looks like a bug/defect task. Before touching code:

1. **Reproduce first.** Watch the failure happen with your own tool call — a bug you haven't seen is a rumor. If you cannot reproduce, say so and investigate the report, don't "fix" blind.
2. **Hypothesize, then trace.** Name the suspected cause, then follow the actual code path (callers included) until the evidence confirms or kills it. Grep every caller of anything you're about to change.
3. **Fix at the root.** The lazy fix IS the root-cause fix — one guard where all callers route through, not a patch on the path the ticket names.
4. **Prove with the repro.** The same check that failed red must now pass green — that pairing is the receipt. A different check proving a different claim doesn't count.
5. **Never retry the same failed fix twice.** A second attempt requires new evidence, not new hope.
