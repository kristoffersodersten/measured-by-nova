# NovaForge AX102 Stack

NovaForge is the operational expression of the compute-distribution boundary on
Hetzner AX102.

It is not generic hosting and must not become a remote desktop replacement. Its
topology is:

```text
persistent sovereign metabolic layer
```

## Role

NovaForge carries sustained thermodynamic load for Namaka systems:

- dependency installation
- Docker and devcontainer execution
- full tests, heavy builds, coverage, benchmarks, and release packaging
- persistent PostgreSQL, Redis, ChromaDB, queues, replay engines, and runtime services
- OCR, embeddings, vectorization, chunking, semantic indexing, and batch processing
- monitoring, backup, and long-running service stability

The Mac Mini remains the sovereign control surface for UI, editing, git
metadata, local secrets, signing material, orchestration approval, lightweight
smoke checks, and local reasoning.

## Base System

The AX102 baseline is Ubuntu Server 24.04 LTS.

Required service classes are:

- Docker Compose
- remote devcontainers
- PostgreSQL
- Redis
- ChromaDB
- queue workers
- OCR workers
- embedding workers
- semantic indexing workers
- reverse proxy
- monitoring
- backup

Implementation may use different package managers or deployment automation, but
the resulting system must expose these service classes as explicit, inspectable
infrastructure. Hidden installation state is invalid.

## First Priority Migration

Move these workloads first:

1. NovaArchive OCR
2. NovaArchive embeddings
3. NovaArchive vectorization
4. NovaArchive chunking
5. NovaArchive semantic indexing
6. ChromaDB remote persistence
7. PostgreSQL remote persistence
8. Redis remote persistence
9. queue workers
10. replay engines

These workloads are metabolic load, not control-surface activity.

## Forbidden Topologies

NovaForge must not become:

- a remote desktop replacement
- generic hosting
- silent local heavy fallback

If AX102 is unavailable, the system must surface the causal failure or route to
another explicit remote proof surface. It must not silently pull heavy execution
back to the Mac Mini.

## Docking Boundary

This document governs the broader AX102 stack that downstream systems can dock
into. Axiom Core may validate the topology, but it is not itself a long-running
service.
