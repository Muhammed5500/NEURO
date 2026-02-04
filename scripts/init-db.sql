-- NEURO Database Initialization Script
-- PostgreSQL 16

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- TOKENS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    decimals SMALLINT DEFAULT 18,
    total_supply NUMERIC(78, 0),
    creator_address VARCHAR(42),
    nadfun_url VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_tokens_symbol ON tokens(symbol);
CREATE INDEX idx_tokens_creator ON tokens(creator_address);
CREATE INDEX idx_tokens_created_at ON tokens(created_at DESC);

-- ============================================
-- TRANSACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tx_hash VARCHAR(66) NOT NULL UNIQUE,
    block_number BIGINT,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42),
    value NUMERIC(78, 0) DEFAULT 0,
    gas_limit BIGINT NOT NULL,
    gas_used BIGINT,
    gas_price NUMERIC(78, 0),
    status VARCHAR(20) DEFAULT 'pending',
    tx_type VARCHAR(50) NOT NULL,
    token_id UUID REFERENCES tokens(id),
    approval_status VARCHAR(20) DEFAULT 'pending',
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_transactions_hash ON transactions(tx_hash);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_approval ON transactions(approval_status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_type ON transactions(tx_type);

-- ============================================
-- APPROVALS TABLE (Manual Approval Queue)
-- ============================================
CREATE TABLE IF NOT EXISTS approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID REFERENCES transactions(id),
    action_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    risk_level VARCHAR(20) DEFAULT 'medium',
    estimated_gas BIGINT,
    estimated_cost_mon NUMERIC(18, 8),
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejected_reason TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_created_at ON approvals(created_at DESC);
CREATE INDEX idx_approvals_risk_level ON approvals(risk_level);

-- ============================================
-- AI DECISIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS ai_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_type VARCHAR(50) NOT NULL,
    input_context JSONB NOT NULL,
    reasoning TEXT NOT NULL,
    output_action JSONB NOT NULL,
    confidence_score NUMERIC(5, 4),
    model_used VARCHAR(100),
    approval_id UUID REFERENCES approvals(id),
    executed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ai_decisions_type ON ai_decisions(decision_type);
CREATE INDEX idx_ai_decisions_created_at ON ai_decisions(created_at DESC);
CREATE INDEX idx_ai_decisions_confidence ON ai_decisions(confidence_score DESC);

-- ============================================
-- MARKET DATA TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID REFERENCES tokens(id),
    price_mon NUMERIC(36, 18),
    price_usd NUMERIC(36, 18),
    volume_24h NUMERIC(36, 18),
    market_cap NUMERIC(36, 18),
    holders_count INTEGER,
    liquidity NUMERIC(36, 18),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_market_data_token ON market_data(token_id);
CREATE INDEX idx_market_data_timestamp ON market_data(timestamp DESC);

-- Hypertable-like partitioning for time-series (manual approach)
-- For production, consider TimescaleDB extension

-- ============================================
-- KILL SWITCH TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS kill_switch (
    id SERIAL PRIMARY KEY,
    enabled BOOLEAN DEFAULT FALSE,
    enabled_by VARCHAR(255),
    enabled_at TIMESTAMP WITH TIME ZONE,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default kill switch state (disabled)
INSERT INTO kill_switch (enabled, reason) VALUES (FALSE, 'Initial state - kill switch disabled');

-- ============================================
-- SYSTEM CONFIG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(255)
);

-- Insert default configurations
INSERT INTO system_config (key, value, description) VALUES
    ('execution_mode', '"READ_ONLY"', 'Current execution mode: READ_ONLY or WRITE_ENABLED'),
    ('manual_approval', 'true', 'Require manual approval for all writes'),
    ('gas_buffer_percentage', '15', 'Gas buffer percentage for Monad transactions'),
    ('max_single_tx_value', '1.0', 'Maximum single transaction value in MON'),
    ('finality_wait_ms', '800', 'Wait time for economic finality in milliseconds');

-- ============================================
-- AUDIT LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255),
    actor VARCHAR(255) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER update_tokens_timestamp
    BEFORE UPDATE ON tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Check kill switch function
CREATE OR REPLACE FUNCTION is_kill_switch_enabled()
RETURNS BOOLEAN AS $$
DECLARE
    switch_enabled BOOLEAN;
BEGIN
    SELECT enabled INTO switch_enabled FROM kill_switch ORDER BY id DESC LIMIT 1;
    RETURN COALESCE(switch_enabled, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO neuro;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO neuro;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO neuro;
