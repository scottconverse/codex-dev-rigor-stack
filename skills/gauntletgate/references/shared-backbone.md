# GauntletGate — shared backbone

Every lane (lite, walkthrough, full) shares these three things. They live here
once so they can never drift apart. A lane that touches a UI, an onboarding flow,
an external dependency, or an empty-data state **must** apply the first-run rule
and the environment attestation below, and **must** classify findings with the one
severity framework below.

---

## 1. The first-run rule (non-negotiable)

The most expensive defect is the one a developer never sees, because the dev box is
already set up — database seeded, model server running, license activated, settings
filled in, first-run flags long cleared. A check run there audits a product that is
*already working*, and reports it clean. Then a real new user hits a wall on the
first screen.

This rule exists because of a real miss: a product was reported **"near-clean (1
Minor)"** while a brand-new user with no model server hit an immediate dead-end —
the core action was disabled and the setup step told them to go install the
dependency themselves. It slipped because (1) the check ran on a provisioned dev
box, so the dependency-absent flow was never on screen, and (2) the "clean profile"
isolation silently failed and nobody verified it.

So, whenever a lane exercises a product with a first-run / onboarding / dependency /
empty-data surface:

1. **Construct and VERIFY the true first-run state** — fresh, isolated profile;
   first-run flags unset; empty data; **every external dependency ABSENT**. *Prove*
   the app actually used the clean state (assert it wrote its config/first-run
   markers to the isolated location, not the real one). An override that "looks set"
   but is silently ignored must be caught here.
2. **Probe dependencies, don't assume them** — actively query the model server / DB
   / license / network and record present-or-absent, measured.
3. **Walk the product with each dependency ABSENT** — the new-user reality where
   dead-ends live — not only with everything conveniently installed.
4. **An already-provisioned environment is DISQUALIFYING** for first-run findings.
   If a clean state can't be verified, first-run coverage is **INVALID** and the run
   may **never** report the product as first-run-clean.
5. **A first-run dead-end on the core feature is a Blocker** — a disabled primary
   action, a "go install X yourself" with no in-product help, a blank screen, or a
   silent failure — not a footnote.

**How to construct & verify the clean state per stack** (web/SaaS, Node, Python,
Electron, Docker, headless API): see `references/isolation-recipes.md`. The universal
pattern: redirect where the app stores state → launch → assert it wrote *there*, not
to the real home → capture that path as the artifact.

**No first-run UI?** For a pure library, API, or CLI with no user-facing first-run
surface, "can a new user reach the core feature?" is **N/A** — state that explicitly
in the attestation (first-run coverage: **N/A**, with the reason) and the verdict's
first-run line reads N/A, not ✅/❌. The other dimensions still apply where they make
sense: a library's "first use from a clean install" (fresh venv / node_modules / a
machine without the global tool), an API's behavior when its **dependency is absent**,
and empty-data/initial-state paths. N/A is a reasoned classification, never a way to
skip a first-run surface that actually exists.

---

## 2. The environment-provisioning attestation (gates the first-run verdict)

No lane may claim a first-run verdict without filling this with **verified facts**.
If it can't be filled, first-run coverage is INVALID and the report says so.

| What | State used | How it was VERIFIED — not assumed |
|---|---|---|
| Profile / `HOME` / `USERPROFILE` / app-data isolation | clean temp dir / fresh container / real profile | confirmed the app wrote config + first-run marker into the isolated path (quote the path it used) |
| First-run flags | unset / already cleared | how confirmed |
| External dependency: `<name>` | ABSENT / present vX, running / stopped | how probed (API call, process check, file check) |
| Data store | empty / populated | how confirmed |
| Network | online / offline / throttled | how set |

**Isolation verified?** YES (app provably used the clean state) / NO (could not confirm)
**→ First-run coverage:** VALID / INVALID (and why)

**Evidence artifact (required — this is what separates a verdict from a claim).**
Every "verified" cell must point to an **on-disk artifact** saved alongside the
report: a captured page/DOM, a Playwright trace, a log, or the captured path the app
actually wrote to. List the artifact files (e.g. `artifacts/first-run-absent.html`,
`artifacts/isolation-path.txt`). **An attestation with no linked artifact is treated
as UNVERIFIED → first-run coverage INVALID.** A self-attested table with nothing
observable behind it does not count — the whole point of the gate is that the
verification is *checkable by someone other than the agent that wrote it.* (Roadmap:
a future release makes this mechanical — no CLEAR TO ADVANCE emitted unless the
artifact files exist on disk.)

---

## 3. Severity framework (one scale, every lane)

Severity = impact × exposure. Use exactly these five labels.

- **Blocker** — cannot ship / cannot advance. Security exposure, data loss, a core
  flow unusable, the documented install doesn't work, **or a new user cannot reach
  the core feature by following the in-product path.**
- **Critical** — must fix before advancing. A reachable security gap; a primary
  feature breaks under realistic conditions; missing error states on a
  failure-prone flow.
- **Major** — should fix soon. Systemic test gap; N+1 on a hot path; unhelpful copy
  across surfaces; an architecture choice that forces a refactor in 6–12 months.
- **Minor** — nice to fix. Dead code, naming, a single skipped test on a
  non-critical feature.
- **Nit** — preference, not a defect. Mention once; never pad the count with Nits.

Security findings are Critical or Blocker by default unless exposure is genuinely
theoretical. Don't inflate (everything-Critical destroys credibility) or soften
(calling a Major a Minor to avoid conflict). When unsure: what breaks if unfixed,
under what conditions, how many users, is there a workaround, does it compound?
