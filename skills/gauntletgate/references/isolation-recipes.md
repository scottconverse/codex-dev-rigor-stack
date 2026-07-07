# Isolation recipes — constructing & VERIFYING a clean first-run state

The first-run rule (shared-backbone §1) requires a *verified* clean,
dependency-absent state — and the attestation must link to an on-disk artifact
proving the app used it. These are concrete, per-stack starting points. They are
recipes, not guarantees: **always verify** the app actually wrote into the isolated
location (capture the path), and **probe** the dependency to confirm it's absent.

The universal pattern: **(1) redirect where the app stores state → (2) launch →
(3) assert it wrote there, not to the real home → (4) capture that path as the
artifact.**

## Web / SaaS (browser profile + backend)
- **Clean profile:** launch the browser/Playwright with a throwaway `userDataDir`
  (e.g. `--user-data-dir=$(mktemp -d)`); never the developer's real profile.
- **Empty data:** point the app at a fresh DB (new schema / new volume), or run with
  the DB **stopped** for the dependency-absent pass.
- **Verify:** confirm cookies/localStorage/IndexedDB are empty at first paint; capture
  a screenshot + the profile path. **Artifact:** `artifacts/first-run.png`, the
  `userDataDir` path.

## Node / npm (CLI or library)
- **Clean install:** `npm pack` then install the tarball into a fresh temp dir
  (`npm i ./pkg.tgz --prefix $(mktemp -d)`), or use a clean `node_modules` — never the
  repo's already-resolved one.
- **Dependency absent:** unset the env var / config the tool needs; or run on a temp
  `HOME` so no global config leaks (`HOME=$(mktemp -d) node bin.js`).
- **Verify + artifact:** capture `npm ls` from the clean prefix and the tool's "not
  configured" output.

## Python / venv
- **Clean install:** `python -m venv $(mktemp -d)/v && <v>/bin/pip install .` — a fresh
  venv, not your working one.
- **Dependency absent:** run with a temp `HOME`/`XDG_CONFIG_HOME` so user config is
  absent; don't pre-set the API key/DSN.
- **Verify + artifact:** capture the import/first-run error or the "configure me"
  message, plus the venv path.

## Electron / desktop
- **Clean profile:** override the user-data dir — `app.setPath('userData', tmp)` or
  launch with `--user-data-dir=<tmp>`; verify by checking the temp dir is populated and
  the real one untouched.
- **Dependency absent:** the bundled/external service (model server, license) not
  installed/running — confirm via process/file probe.
- **Verify + artifact:** screenshot of the first-run window + the captured userData path.

## Docker / containerized
- **Clean state:** run from the built image with **fresh, empty volumes** (no
  bind-mount of dev data); a brand-new container is your clean profile.
- **Dependency absent:** don't start the linked dependency container (or stop it);
  confirm with `docker ps`.
- **Verify + artifact:** `docker logs` showing first-run/dep-absent behavior + the
  `docker ps` output proving the dependency wasn't running.

## API / backend service (no UI)
- First-run is **N/A** for "reach the core feature," but the **dependency-absent**
  dimension applies: start the service with its datastore/upstream **down** and assert
  it fails *clearly* (right status code, honest error) rather than 500-ing or hanging.
- **Artifact:** the captured response/headers and a log line.

> If you can't construct or verify the clean state for a given stack, say so in the
> report and mark first-run coverage **INVALID** — never report clean off a state you
> couldn't verify.
