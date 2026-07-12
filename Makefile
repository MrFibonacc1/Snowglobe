.PHONY: up down logs setup-check check

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

setup-check: .venv-check/.requirements-installed

.venv-check/.requirements-installed: requirements-test.txt
	@test -x .venv-check/bin/python || python3 -m venv .venv-check
	@.venv-check/bin/python -m pip install --disable-pip-version-check -q -r requirements-test.txt
	@touch $@

check: setup-check
	@./scripts/check-local.sh
