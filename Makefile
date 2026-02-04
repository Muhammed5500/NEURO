# ============================================
# NEURO Monorepo Makefile
# Monad Mainnet (Chain ID: 143)
# ============================================

.PHONY: all install build dev test lint clean docker-up docker-down help

# Default target
all: install build

# ============================================
# INSTALLATION
# ============================================

install: ## Install all dependencies
	pnpm install
	@echo "Installing Rust dependencies..."
	cd services/ingestion && cargo build --release

install-dev: ## Install with dev dependencies
	pnpm install
	cd services/ingestion && cargo build

# ============================================
# BUILD
# ============================================

build: ## Build all packages
	pnpm build

build-dashboard: ## Build dashboard only
	pnpm --filter @neuro/dashboard build

build-services: ## Build all TypeScript services
	pnpm --filter "@neuro/orchestrator" --filter "@neuro/execution" --filter "@neuro/memory" --filter "@neuro/verification" build

build-contracts: ## Build smart contracts
	cd contracts/neuro-core && forge build

build-rust: ## Build Rust ingestion service
	cd services/ingestion && cargo build --release

# ============================================
# DEVELOPMENT
# ============================================

dev: ## Run all services in development mode
	pnpm dev

dev-dashboard: ## Run dashboard in dev mode
	pnpm --filter @neuro/dashboard dev

dev-orchestrator: ## Run orchestrator in dev mode
	pnpm --filter @neuro/orchestrator dev

dev-execution: ## Run execution service in dev mode
	pnpm --filter @neuro/execution dev

dev-memory: ## Run memory service in dev mode
	pnpm --filter @neuro/memory dev

dev-verification: ## Run verification service in dev mode
	pnpm --filter @neuro/verification dev

dev-ingestion: ## Run Rust ingestion service
	cd services/ingestion && cargo run

# ============================================
# TESTING
# ============================================

test: ## Run all tests
	pnpm test
	cd services/ingestion && cargo test
	cd contracts/neuro-core && forge test

test-ts: ## Run TypeScript tests only
	pnpm test

test-rust: ## Run Rust tests only
	cd services/ingestion && cargo test

test-contracts: ## Run smart contract tests
	cd contracts/neuro-core && forge test -vvv

test-coverage: ## Run tests with coverage
	pnpm test -- --coverage
	cd contracts/neuro-core && forge coverage

# ============================================
# LINTING & FORMATTING
# ============================================

lint: ## Run linters
	pnpm lint
	cd services/ingestion && cargo clippy
	cd contracts/neuro-core && forge fmt --check

lint-fix: ## Fix linting issues
	pnpm lint --fix
	cd services/ingestion && cargo clippy --fix --allow-dirty
	cd contracts/neuro-core && forge fmt

format: ## Format all code
	pnpm format
	cd services/ingestion && cargo fmt
	cd contracts/neuro-core && forge fmt

format-check: ## Check formatting
	pnpm format:check
	cd services/ingestion && cargo fmt --check
	cd contracts/neuro-core && forge fmt --check

typecheck: ## Run TypeScript type checking
	pnpm typecheck

# ============================================
# DOCKER
# ============================================

docker-up: ## Start Docker infrastructure
	docker-compose up -d
	@echo "Waiting for services to be ready..."
	@sleep 5
	@echo "Infrastructure ready!"

docker-down: ## Stop Docker infrastructure
	docker-compose down

docker-logs: ## View Docker logs
	docker-compose logs -f

docker-clean: ## Remove Docker volumes
	docker-compose down -v

docker-build: ## Build Docker images
	docker-compose build

# ============================================
# DATABASE
# ============================================

db-migrate: ## Run database migrations
	pnpm --filter @neuro/shared db:migrate

db-generate: ## Generate Prisma client
	pnpm --filter @neuro/shared db:generate

db-reset: ## Reset database
	docker-compose exec postgres psql -U neuro -d neuro_db -f /docker-entrypoint-initdb.d/init.sql

db-seed: ## Seed database with test data
	pnpm --filter @neuro/shared db:seed

# ============================================
# SMART CONTRACTS
# ============================================

contracts-build: ## Build contracts
	cd contracts/neuro-core && forge build

contracts-test: ## Test contracts
	cd contracts/neuro-core && forge test

contracts-deploy-local: ## Deploy to local network
	cd contracts/neuro-core && forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

contracts-deploy-monad: ## Deploy to Monad Mainnet (requires .env)
	@echo "WARNING: Deploying to Monad Mainnet!"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	cd contracts/neuro-core && forge script script/Deploy.s.sol --rpc-url $(MONAD_RPC_URL) --broadcast --verify

# ============================================
# UTILITIES
# ============================================

clean: ## Clean all build artifacts
	pnpm clean
	rm -rf node_modules
	rm -rf **/node_modules
	rm -rf **/.turbo
	rm -rf **/dist
	rm -rf **/.next
	cd services/ingestion && cargo clean
	cd contracts/neuro-core && forge clean

refresh: clean install build ## Clean and rebuild everything

# ============================================
# PRODUCTION
# ============================================

start: ## Start all services in production mode
	pnpm start

start-dashboard: ## Start dashboard in production mode
	pnpm --filter @neuro/dashboard start

# ============================================
# HELP
# ============================================

help: ## Show this help message
	@echo "NEURO Monorepo - Monad Mainnet (Chain ID: 143)"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
