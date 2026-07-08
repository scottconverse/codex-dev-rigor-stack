RIGOR ROUTER — DECOMPOSITION + EVIDENCE GATE matched for this task. (If this prompt isn't asking for code work, ignore this note.)

This is multi-part work. The failure mode is finishing three parts well and hand-waving the fourth:

1. **Decompose before building.** List every story/part the request contains — including the implicit ones (wiring, error paths, docs the user will read). The list is the contract for "done".
2. **Per-story evidence gate.** No story is done without its own check that would fail if that story broke. "The feature works" is not evidence for any single story.
3. **No silent scope drops.** If a part turns out infeasible or out of scope, say so explicitly — a story that vanishes from the report without a reason is theater.
4. **Report per-story.** The final summary walks the same list: each part, its check, its result. Where the platform offers goal loops, phrase each story as a goal with a deterministic exit and a try cap, so an evaluator that isn't you owns "done".
