.PHONY: dev backend frontend install install-backend install-frontend test-backend

# Python from the pixi-managed global 'main' env (absolute path so recipes
# work regardless of whether ~/.pixi/bin is on the shell PATH). If the venv
# under backend/.venv exists it takes precedence (reproducible local setup).
PYTHON := $(wildcard backend/.venv/bin/python backend/.venv/Scripts/python)
ifeq ($(strip $(PYTHON)),)
PYTHON := $(HOME)/.pixi/envs/main/bin/python
endif
NPM    := $(shell command -v npm || echo $(HOME)/.pixi/bin/npm)

dev: ## Start both backend and frontend (default: German demo mode)
	@echo "Starting German Electricity Market Dashboard..."
	$(MAKE) -j2 backend frontend

backend: ## Start FastAPI backend on :8000 (demo mode by default)
	cd backend && $(PYTHON) -m granian --interface asgi --host 0.0.0.0 --port 8000 --reload app.main:app

frontend: ## Start Vite frontend on :5173
	cd frontend && $(NPM) run dev

install: install-backend install-frontend ## Install both backend and frontend deps

install-backend: ## Create backend venv and install Python deps
	python -m venv backend/.venv
	cd backend && .venv/bin/python -m pip install -r requirements.txt

install-frontend: ## Install frontend Node deps
	cd frontend && $(NPM) install

test-backend: ## Run backend tests
	cd backend && $(PYTHON) -m pytest tests/ -v