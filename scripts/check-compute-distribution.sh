#!/bin/bash
set -euo pipefail

description="${*:-}"

if [[ -z "$description" ]]; then
  cat >&2 <<'USAGE'
Usage:
  scripts/check-compute-distribution.sh "command or workload description"

The Mac Mini is a control surface. Heavy workloads must run on Hetzner or GitHub Actions.
USAGE
  exit 64
fi

normalized="$(printf '%s' "$description" | tr '[:upper:]' '[:lower:]')"

heavy_patterns=(
  "pnpm install"
  "pnpm i"
  "pnpm test"
  "pnpm -r test"
  "pnpm build"
  "pnpm validate"
  "pnpm benchmark"
  "pnpm harness"
  "pnpm render"
  "render:review"
  "npm install"
  "npm ci"
  "npm test"
  "npm run test"
  "npm run build"
  "npm run validate"
  "corepack enable"
  "yarn install"
  "yarn test"
  "yarn build"
  "bun install"
  "bun test"
  "bun run build"
  "uv sync"
  "uv pip install"
  "poetry install"
  "swift build"
  "swift test"
  "xcodebuild"
  "cargo build"
  "cargo test"
  "cargo install"
  "go test ./..."
  "python -m pip install"
  "pip install"
  "python -m compileall"
  "pytest"
  "unittest discover"
  "pip-audit"
  "security_audit"
  "pre-commit run --all-files"
  "docker build"
  "docker compose"
  "docker run"
  "docker pull"
  "docker system"
  "docker image"
  "docker volume"
  "devcontainer"
  "devcontainers"
  "coverage"
  "benchmark"
  "ocr"
  "tesseract"
  "poppler"
  "pdfplumber"
  "pymupdf"
  "embedding"
  "sentence-transformers"
  "transformers"
  "torch"
  "accelerate"
  "vector"
  "vectorization"
  "indexing"
  "chroma"
  "chromadb"
  "postgres"
  "postgresql"
  "redis"
  "redis-server"
  "celery"
  "meilisearch"
  "tantivy"
  "release"
  "package"
  "backtest"
  "simulation"
  "prediction"
  "replay"
  "schema validation"
  "full registry"
  "organization-wide"
  "generated registry"
)

for pattern in "${heavy_patterns[@]}"; do
  if [[ "$normalized" == *"$pattern"* ]]; then
    cat >&2 <<EOF
blocked_local_heavy_compute
target=Hetzner_AX102
matched=$pattern

Run this through VS Code Remote SSH on Hetzner, GitHub Actions, or another explicit remote proof surface.
EOF
    exit 2
  fi
done

cat <<'EOF'
mac_allowed_bounded_smoke
target=Mac_Mini

This looks local-safe only if it is short, bounded, and does not create sustained CPU, RAM, swap, thermal, Docker, indexing, OCR, embedding, build, or full-test load.
EOF
