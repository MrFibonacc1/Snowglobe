.PHONY: up down logs check

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

check:
	python3 -m unittest discover -s automation/tests -v
	python3 -m unittest discover -s perception/tests -v
	npm --prefix dashboard run build
	docker compose config --quiet
