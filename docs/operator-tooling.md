# Operator Tooling Contract

This repository uses local operator tools to enforce the Mac Mini / Hetzner
compute boundary.

The tools may live outside this repository on the operator machine, but their
behavior is part of the compute-distribution contract. A repository is not
protected merely because files exist locally; tooling must prove the surfaces,
route heavy work away from the Mac Mini, and fail closed when proof would be
stale.

## Required Tools

- `remote-compute-adopt`
- `remote-compute-audit`
- `remote-compute-inventory`
- `remote-compute-inventory-summary`
- `remote-compute-inventory-action-plan`
- `remote-compute-inventory-decision-template`
- `remote-compute-provision`
- `remote-compute-run`
- `remote-compute-reconcile-report`
- `remote-compute-reconcile-plan`
- `remote-compute-reconcile-preservation-plan`
- `remote-compute-reconcile-export`
- `remote-compute-reconcile-verify-export`
- `remote-compute-reconcile-mutation-preflight`
- `remote-compute-reconcile-approval-template`
- `remote-compute-reconcile-verify-approval`
- `remote-compute-reconcile-mutation-packet`
- `remote-compute-doctor`
- `local-sovereignty-audit`

## Required Behavior

`remote-compute-adopt` installs the project contract surfaces and must not
silently overwrite dirty existing files.

`remote-compute-audit` fails closed when a required contract surface is missing,
incomplete, non-executable where execution is required, or hidden by
`.gitignore`.

`remote-compute-inventory` reports repository state without mutating it. Owned
dirty repositories with valid contracts must be classified as
`protected_dirty_local_only`, not as ready remote proof targets.

`remote-compute-inventory-summary` summarizes inventory coverage without
mutating repositories. It must report protected, dirty-protected, external,
container/no-origin, and auto-adopt candidate counts in machine-readable form
so operators can see which repositories are safe to touch.

`remote-compute-inventory-action-plan` converts inventory state into a
read-only per-repository action plan. It must classify each repository as
already protected, requiring verified reconcile approval, requiring fork or
ownership decision, requiring project identity decision, or requiring manual
classification. It must not mutate repositories.

`remote-compute-inventory-decision-template` converts the action plan into a
read-only, human-fillable decision template. It must default every unresolved
decision to `selected_decision: null`, `mutation_allowed: false`, and must not
approve adoption, create branches, or write files.

`remote-compute-provision` is the clean-bundle path for remote workspace
provisioning. It must refuse unclean local worktrees unless the workflow
explicitly preserves or packages the state being provisioned.

When the local worktree is clean, the generated bundle is the authoritative
remote workspace state. `remote-compute-provision` must update the remote branch
and tracking ref from the bundle even if the Hetzner workspace is otherwise
clean. A clean but stale remote workspace is invalid proof.

`remote-compute-run` executes commands on Hetzner, not locally. It must refuse
dirty local worktrees by default because the remote workspace may represent
stale code. `--allow-dirty-local` is allowed only as an explicit
human-approved non-proof override.

`remote-compute-reconcile-report` reports dirty protected repositories before
any integration strategy is selected. It must be read-only and must surface the
branch, upstream delta, dirty count, local-only contract files, and changed
paths so the human can choose merge, stash, branch, or manual reconciliation
without losing local state. It must also expose a recommended next step and a
machine-readable JSON form so downstream operators can review the strategy
without parsing terminal prose.

`remote-compute-reconcile-plan` converts the read-only report into an explicit
read-only sequence of strategy phases. It must not execute merge, stash, reset,
checkout, add, commit, or file writes; it only prepares the human-approved
reconcile path.

`remote-compute-reconcile-preservation-plan` converts the read-only report into
explicit preservation preconditions before any dirty protected repository is
mutated. It must emit the dirty head, dirty count, preservation requirement,
suggested preservation branch, verified-export requirement, human-approval
requirement, and read-only flag without creating branches or writing files.

`remote-compute-reconcile-export` writes reconcile evidence to an explicit
external artifact directory. It may export status, patches, upstream diffs, and
local contract-file copies, but it must not write inside source repositories or
execute merge, stash, reset, checkout, add, or commit. It must include
checksums for exported artifacts so the reconcile evidence can be verified
before manual application.

`remote-compute-reconcile-verify-export` verifies an exported reconcile artifact
directory before any manual application. It must check required files,
manifest rows, JSON structure, read-only plan flags, and checksums.

`remote-compute-reconcile-mutation-preflight` verifies that an exported
reconcile artifact still matches the current dirty repository state before any
human-approved mutation. It must fail closed when the dirty head, branch, dirty
count, preservation flags, or export checksums drift.

`remote-compute-reconcile-approval-template` emits a read-only, machine-readable
approval template after export verification and mutation preflight pass. It must
default every repository to `approved: false` and must not create branches or
write files.

`remote-compute-reconcile-verify-approval` verifies a human-filled approval file
against the exported reconcile artifact and current mutation preflight. It must
fail closed unless every repository row is approved with non-empty approval
reason, approver, and approval timestamp. It must not create branches or write
files.

`remote-compute-reconcile-mutation-packet` emits the final read-only mutation
packet after approval verification succeeds. It may describe preservation branch
commands and evidence paths, but it must not create branches, write files, or
execute merge, stash, reset, checkout, add, or commit.

`remote-compute-doctor` verifies local tooling, inventory, remote reachability,
and standard remote workspaces without turning a failure into local heavy
execution.

`local-sovereignty-audit` verifies the full operator surface:

- shell syntax of operator tools
- constitutional compute-distribution policy
- protected repository contracts
- heavy-workload guard refusal
- light git operation allowance
- VS Code remote-compute tasks
- remote workspace health
- dirty-worktree refusal in `remote-compute-run`

## Proof Rule

Heavy completion proof must come from GitHub Actions or Hetzner. Local operator
tool output is valid only for routing, contract inspection, bounded smoke
checks, and refusal proof.

If a remote proof surface is unavailable, the correct result is a visible causal
failure. The tools must not silently execute heavy work on the Mac Mini.
