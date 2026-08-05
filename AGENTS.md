# Remote Compute Distribution

This project follows the Mac Mini / Hetzner compute boundary.

## Execution Identity

- `Mac_Mini`: local control surface only.
- `Hetzner_AX102`: remote metabolic infrastructure.

## Mac Mini Allowed

- VS Code GUI
- editing
- code navigation
- git status, diff, branch, commit, push, pull, PR metadata
- local secrets and signing material
- lightweight smoke checks that finish quickly and do not create sustained memory, swap, thermal, Docker, indexing, OCR, embedding, build, or test load

## Hetzner Required

- dependency installs
- Docker and devcontainers
- full test suites
- CI reproduction
- heavy builds and release packaging
- long-running dev servers
- database services
- embeddings, vectorization, semantic indexing
- OCR and batch document processing
- coverage generation
- benchmark gates
- background inference

## Required Workflow

Open the project through VS Code Remote SSH when doing real implementation:

```text
VS Code GUI: Mac Mini
Workspace: Hetzner
Terminal: Hetzner
Heavy proof: GitHub Actions or Hetzner
```

Local Mac checkouts are for navigation, small edits, and emergency fixes only. Do not present heavy local execution as completion proof.

## Proof Integrity

Remote proof must correspond to explicit project state. If the local worktree is
dirty, `remote-compute-run` refuses by default because the Hetzner workspace may
represent stale code. Commit or stash the local changes, use
`remote-compute-provision` for a clean bundle, or use `--allow-dirty-local`
only as an explicit human-approved non-proof override.

## Versionability

The compute-distribution contract surfaces must be versionable:

- `docs/compute-distribution.md`
- `docs/operator-tooling.md`
- `docs/remote-workspace.md`
- `docs/novaforge-ax102-stack.md`
- `scripts/check-compute-distribution.sh`
- `AGENTS.md`
- `.vscode/tasks.json`

Do not hide these files behind `.gitignore`. `remote-compute-audit` treats
ignored contract files as invalid even when they exist locally.

## Override

Local heavy compute requires explicit human override for the specific task. Hidden fallback to the Mac Mini is invalid.
