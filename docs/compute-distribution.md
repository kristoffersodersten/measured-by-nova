# Compute Distribution

This project uses the global Mac Mini / Hetzner workload split.

## Rule

The Mac Mini is the local control surface. Hetzner is the compute substrate.

## Local Safe

- VS Code GUI
- code reading and editing
- `git status`
- `git diff`
- `git log`
- small targeted smoke checks
- secrets/signing operations that must remain local

## Remote Required

- dependency installation
- Docker and devcontainers
- full test suites
- CI reproduction
- release builds and packaging
- coverage
- benchmarks
- OCR
- embeddings
- vector indexing
- long-running servers
- databases
- background inference

## Operator Workflow

Use VS Code Remote SSH for normal work:

```text
Remote host: ubuntu
Remote workspace: /home/krille/work/Measured by Nova
```

Use GitHub Actions or Hetzner terminal output as proof for heavy gates. Local Mac output is valid only for bounded smoke checks.

Remote proof is valid only when it corresponds to the explicit project state.
If the local worktree is dirty, `remote-compute-run` must refuse by default
because the Hetzner workspace may represent stale code. Commit or stash the
local changes, use `remote-compute-provision` for a clean bundle, or make an
explicit human-approved non-proof override with `--allow-dirty-local`.

Dirty protected repositories require read-only reconciliation evidence before
any merge, stash, branch, reset, or manual integration strategy is selected.
Use `remote-compute-reconcile-report` to surface upstream delta, dirty count,
local-only contract files, changed paths, and a recommended next step without
mutating the worktree. The same evidence is available with
`remote-compute-reconcile-report --json`.
Use `remote-compute-inventory-summary` before broad adoption decisions to expose
protected, dirty-protected, external, container/no-origin, and auto-adopt
candidate counts without mutating repositories.
Use `remote-compute-inventory-action-plan` to convert inventory state into a
read-only per-repository action plan before deciding whether a repo needs
reconcile approval, fork/ownership decision, project identity decision, or no
action.
Use `remote-compute-inventory-decision-template` to turn unresolved action-plan
rows into a read-only, human-fillable decision template. Unresolved decisions
must remain `selected_decision: null` and `mutation_allowed: false` until a
separate human review fills the template.
Use `remote-compute-reconcile-plan` to inspect the read-only phase plan before
any human-approved local mutation.
Use `remote-compute-reconcile-preservation-plan` to inspect the dirty head,
dirty count, suggested preservation branch, verified-export requirement, and
human-approval requirement before any dirty protected repository is mutated.
Use `remote-compute-reconcile-export --out <dir>` to write patches and evidence
outside the source repository before a manual reconcile.
Exported reconcile evidence must include checksums for replayability and
integrity review.
Verify exported reconcile evidence with
`remote-compute-reconcile-verify-export <dir>` before manual application.
Run `remote-compute-reconcile-mutation-preflight <dir>` before any
human-approved mutation to prove the verified export still matches current
dirty repository state.
Generate `remote-compute-reconcile-approval-template <dir>` before any dirty
protected repository is mutated; every repository must remain `approved: false`
until explicit human review changes that approval outside this read-only step.
Verify the human-filled approval file with
`remote-compute-reconcile-verify-approval <dir> <approval.json>` before any
mutation; approval is invalid unless each repository row is explicitly approved
with reason, approver, and timestamp.
Generate `remote-compute-reconcile-mutation-packet <dir> <approval.json>` after
approval verification and before mutation; the packet must remain read-only and
surface exact preservation branches, dirty heads, evidence paths, and
operator-visible commands.

## Versionability

These contract surfaces must be versionable and must not be hidden by
`.gitignore`:

- `docs/compute-distribution.md`
- `docs/operator-tooling.md`
- `docs/remote-workspace.md`
- `docs/novaforge-ax102-stack.md`
- `scripts/check-compute-distribution.sh`
- `AGENTS.md`
- `.vscode/tasks.json`

`remote-compute-audit` fails closed if any of these files exist only as ignored
local state.

## NovaForge Stack

This project docks into the AX102 stack documented in
`docs/novaforge-ax102-stack.md`.

## Operator Tooling

`docs/operator-tooling.md` defines the local tools that enforce this boundary.
`docs/remote-workspace.md` defines the Hetzner workspace and proof rules.

## Local Guard

Run:

```bash
scripts/check-compute-distribution.sh "command or workload description"
```

The guard exits non-zero for known heavy local workloads.
