SHELL       := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

PNPM     := pnpm
WRANGLER := $(PNPM) wrangler

REPO_DIR   := $(CURDIR)
CLI_SRC    := $(REPO_DIR)/img-hosting/bin/img-hosting
SKILL_SRC  := $(REPO_DIR)/img-hosting
CLI_LINK   := $(HOME)/bin/img-hosting
SKILL_LINK := $(HOME)/.claude/skills/img-hosting

# ----------------------------------------------------------------- help ----
.PHONY: help
help: ## Show this help.
	@awk 'BEGIN { \
		printf "\nimg-hosting Makefile\n\n  usage: make <target>\n\nTargets:\n" \
	} /^[a-zA-Z_.-]+:.*?##/ { \
		printf "  \033[36m%-16s\033[0m %s\n", $$1, substr($$0, index($$0,"##")+3) \
	} END { printf "\n" }' $(MAKEFILE_LIST)

# ----------------------------------------------------------- dependencies --
.PHONY: install
install: node_modules ## Install pnpm dependencies.

node_modules: package.json pnpm-lock.yaml
	$(PNPM) install
	@touch node_modules

# ------------------------------------------------------------- code build --
.PHONY: build
build: install typecheck ## Build (typecheck-only; Wrangler bundles on deploy).
	@echo "✔  typecheck passed; wrangler bundles src/ at deploy time"

.PHONY: typecheck
typecheck: install ## Strict tsc --noEmit.
	$(PNPM) typecheck

.PHONY: test
test: install ## Vitest run against the Workers test pool.
	$(PNPM) test

.PHONY: test-watch
test-watch: install ## Vitest in watch mode.
	$(PNPM) test:watch

.PHONY: dev
dev: install wrangler.toml ## wrangler dev on :8787.
	$(WRANGLER) dev

# ------------------------------------------------------ Cloudflare resources
.PHONY: bucket
bucket: ## Create the R2 bucket (one-time).
	$(WRANGLER) r2 bucket create img-hosting

.PHONY: db
db: ## Create the D1 database (one-time). Paste database_id into wrangler.toml after.
	$(WRANGLER) d1 create img-hosting

.PHONY: db-local
db-local: install wrangler.toml ## Apply schema.sql to the local D1.
	$(PNPM) db:local

.PHONY: db-remote
db-remote: install wrangler.toml ## Apply schema.sql to the remote D1.
	$(PNPM) db:remote

.PHONY: secret
secret: install wrangler.toml ## Set API_KEY secret on the deployed Worker.
	$(WRANGLER) secret put API_KEY

# -------------------------------------------------------------- deployment --
wrangler.toml: wrangler.toml.example
	@if [ ! -f wrangler.toml ]; then \
		cp wrangler.toml.example wrangler.toml; \
		echo "wrote wrangler.toml from template — fill in database_id then re-run"; \
		exit 1; \
	fi

.PHONY: deploy
deploy: install wrangler.toml test typecheck ## Deploy after tests + typecheck pass.
	$(WRANGLER) deploy

.PHONY: deploy-fast
deploy-fast: install wrangler.toml ## Deploy without running tests.
	$(WRANGLER) deploy

.PHONY: logs
logs: install ## Tail production logs.
	$(WRANGLER) tail

# ---------------------------------------------------------- CLI / skill install
$(CLI_LINK): $(CLI_SRC)
	@mkdir -p $(HOME)/bin
	@ln -sfn $(CLI_SRC) $(CLI_LINK)
	@echo "symlink: $(CLI_LINK) -> $(CLI_SRC)"
	@case ":$$PATH:" in *":$(HOME)/bin:"*) : ;; \
		*) echo "  note: $(HOME)/bin is not on PATH; add: export PATH=\"$$HOME/bin:$$PATH\"" ;; \
	esac

$(SKILL_LINK): $(SKILL_SRC)
	@mkdir -p $(HOME)/.claude/skills
	@ln -sfn $(SKILL_SRC) $(SKILL_LINK)
	@echo "symlink: $(SKILL_LINK) -> $(SKILL_SRC)"

.PHONY: install-cli
install-cli: $(CLI_LINK) ## Symlink CLI to ~/bin/img-hosting.

.PHONY: install-skill
install-skill: $(SKILL_LINK) ## Symlink skill to ~/.claude/skills/img-hosting.

.PHONY: install-all
install-all: install-cli install-skill ## Install both CLI and skill.

.PHONY: uninstall
uninstall: ## Remove CLI + skill symlinks (does not touch the repo).
	@rm -f $(CLI_LINK) $(SKILL_LINK)
	@echo "removed $(CLI_LINK)"
	@echo "removed $(SKILL_LINK)"

# ------------------------------------------------------------- smoke / live
.PHONY: smoke
smoke: ## Hit the deployed worker with health + auth + 401 checks.
	@if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	: $${WORKER_URL:?WORKER_URL not set (put it in .env)}; \
	echo "GET $$WORKER_URL/healthz"; \
	curl -fsS "$$WORKER_URL/healthz"; echo; \
	echo "POST /3/image (no auth) — expect 401"; \
	curl -sS -w '\nHTTP %{http_code}\n' -X POST --data-binary @/dev/null \
		"$$WORKER_URL/3/image"

# ------------------------------------------------------- one-shot bootstrap --
.PHONY: bootstrap
bootstrap: install bucket db ## First-time setup: deps + R2 + D1 (then edit wrangler.toml, then run db-remote/secret/deploy).
	@echo
	@echo "Next steps:"
	@echo "  1. paste the printed database_id into wrangler.toml"
	@echo "  2. make db-remote"
	@echo "  3. make secret    # paste your API_KEY"
	@echo "  4. make deploy"

# -------------------------------------------------------------- housekeeping
.PHONY: clean
clean: ## Remove node_modules and wrangler cache (keeps secrets).
	rm -rf node_modules .wrangler dist coverage

.PHONY: distclean
distclean: clean ## Also remove local wrangler.toml and lockfile. Keeps .env / .dev.vars.
	rm -f wrangler.toml pnpm-lock.yaml
