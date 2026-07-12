# Supervised Durable Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the product with one command, automatically restart failed services, and preserve workflow cooldown state across automation restarts.

**Architecture:** Cooldown acquisition becomes an atomic SQLite operation. Root Docker Compose builds automation, perception, dashboard, and go2rtc with health checks, restart policies, dependency ordering, and named persistent volumes. A Makefile exposes the one-command lifecycle without relying on virtualenv shebangs.

**Tech Stack:** Docker Compose, Python 3, SQLite, FastAPI health checks, Vite/nginx.

## Global Constraints

- `docker compose up --build -d` is the canonical one-command startup.
- Automation and perception restart automatically after process failure.
- Cooldown claims survive automation restarts and are atomic.
- SQLite data uses a named volume and is never stored inside an ephemeral container layer.

---

### Task 1: Persistent cooldown claims

**Files:** Modify `automation/storage.py` and `automation/engine.py`; create `automation/tests/test_cooldowns.py`.

**Interfaces:** `claim_cooldown(workflow_id: str, location: str, window_sec: float, now: float | None = None) -> bool`.

- [x] Write a failing persistent cooldown test against one database.
- [x] Add `cooldown_claims` and transactional compare/update behavior.
- [x] Replace `_last_fire` with `storage.claim_cooldown`.
- [x] Verify focused tests pass.

### Task 2: Containerized supervised stack

**Files:** Create `automation/Dockerfile`, `dashboard/Dockerfile`, `dashboard/nginx.conf`, root `docker-compose.yml`, `Makefile`; modify `README.md`.

**Interfaces:** health endpoints `/health`; ports dashboard 5173, automation 8000, perception 8008, go2rtc 1984/8554.

- [x] Add production container images using module execution rather than venv entrypoint shebangs.
- [x] Add health checks, `restart: unless-stopped`, service dependencies, and `automation-data` volume.
- [x] Add `make up`, `make down`, `make logs`, and `make check`.
- [x] Run `docker compose config`; valid resolved configuration.

## Verification note (2026-07-12)

`docker compose config --quiet` passes. Image construction was attempted but
the local Docker daemon was not running (`~/.docker/run/docker.sock` missing),
so the images could not be built in this session.
