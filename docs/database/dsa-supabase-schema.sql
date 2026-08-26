-- DSA Supabase PostgreSQL 初始化脚本
-- 可直接粘贴到 Supabase SQL Editor 执行。执行前请确认不会覆盖同名 dsa_* 表。
-- 此脚本只创建 DSA 表，不会读写 investment_prediction_* 表。
BEGIN;

CREATE TABLE IF NOT EXISTS dsa_schema_migrations (
	version VARCHAR(64) NOT NULL, 
	description VARCHAR(255) NOT NULL, 
	applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (version)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_schema_migrations_applied_at ON dsa_schema_migrations (applied_at);

CREATE TABLE IF NOT EXISTS dsa_stock_daily (
	id SERIAL NOT NULL, 
	code VARCHAR(10) NOT NULL, 
	date DATE NOT NULL, 
	open FLOAT, 
	high FLOAT, 
	low FLOAT, 
	close FLOAT, 
	volume FLOAT, 
	amount FLOAT, 
	pct_chg FLOAT, 
	ma5 FLOAT, 
	ma10 FLOAT, 
	ma20 FLOAT, 
	volume_ratio FLOAT, 
	data_source VARCHAR(50), 
	canonical_id VARCHAR(32), 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_code_date UNIQUE (code, date)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_stock_daily_date ON dsa_stock_daily (date);

CREATE INDEX IF NOT EXISTS dsa_ix_stock_daily_canonical_id ON dsa_stock_daily (canonical_id);

CREATE INDEX IF NOT EXISTS dsa_ix_code_date ON dsa_stock_daily (code, date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_stock_daily_code ON dsa_stock_daily (code);

CREATE TABLE IF NOT EXISTS dsa_news_intel (
	id SERIAL NOT NULL, 
	query_id VARCHAR(64), 
	code VARCHAR(10) NOT NULL, 
	name VARCHAR(50), 
	dimension VARCHAR(32), 
	query VARCHAR(255), 
	provider VARCHAR(32), 
	title VARCHAR(300) NOT NULL, 
	snippet TEXT, 
	url VARCHAR(1000) NOT NULL, 
	source VARCHAR(100), 
	published_date TIMESTAMP WITHOUT TIME ZONE, 
	fetched_at TIMESTAMP WITHOUT TIME ZONE, 
	query_source VARCHAR(32), 
	requester_platform VARCHAR(20), 
	requester_user_id VARCHAR(64), 
	requester_user_name VARCHAR(64), 
	requester_chat_id VARCHAR(64), 
	requester_message_id VARCHAR(64), 
	requester_query VARCHAR(255), 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_news_url UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS dsa_ix_news_code_pub ON dsa_news_intel (code, published_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_news_intel_code ON dsa_news_intel (code);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_news_intel_dimension ON dsa_news_intel (dimension);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_news_intel_published_date ON dsa_news_intel (published_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_news_intel_query_source ON dsa_news_intel (query_source);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_news_intel_query_id ON dsa_news_intel (query_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_news_intel_provider ON dsa_news_intel (provider);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_news_intel_fetched_at ON dsa_news_intel (fetched_at);

CREATE TABLE IF NOT EXISTS dsa_intelligence_sources (
	id SERIAL NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	source_type VARCHAR(32) NOT NULL, 
	url VARCHAR(1000) NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	scope_type VARCHAR(32) NOT NULL, 
	scope_value VARCHAR(64), 
	market VARCHAR(32) NOT NULL, 
	description TEXT, 
	last_status VARCHAR(32), 
	last_error TEXT, 
	last_fetched_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_enabled ON dsa_intelligence_sources (enabled);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_last_fetched_at ON dsa_intelligence_sources (last_fetched_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_scope_value ON dsa_intelligence_sources (scope_value);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_source_type ON dsa_intelligence_sources (source_type);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_updated_at ON dsa_intelligence_sources (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_market ON dsa_intelligence_sources (market);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_created_at ON dsa_intelligence_sources (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_intel_source_scope ON dsa_intelligence_sources (scope_type, scope_value, market);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_sources_scope_type ON dsa_intelligence_sources (scope_type);

CREATE UNIQUE INDEX dsa_ix_dsa_intelligence_sources_name ON dsa_intelligence_sources (name);

CREATE TABLE IF NOT EXISTS dsa_fundamental_snapshot (
	id SERIAL NOT NULL, 
	query_id VARCHAR(64) NOT NULL, 
	code VARCHAR(10) NOT NULL, 
	payload TEXT NOT NULL, 
	source_chain TEXT, 
	coverage TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_fundamental_snapshot_created_at ON dsa_fundamental_snapshot (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_fundamental_snapshot_query_id ON dsa_fundamental_snapshot (query_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_fundamental_snapshot_code ON dsa_fundamental_snapshot (code);

CREATE INDEX IF NOT EXISTS dsa_ix_fundamental_snapshot_query_code ON dsa_fundamental_snapshot (query_id, code);

CREATE INDEX IF NOT EXISTS dsa_ix_fundamental_snapshot_created ON dsa_fundamental_snapshot (created_at);

CREATE TABLE IF NOT EXISTS dsa_screening_runs (
	id SERIAL NOT NULL, 
	run_id VARCHAR(64) NOT NULL, 
	strategy VARCHAR(64) NOT NULL, 
	market VARCHAR(16) NOT NULL, 
	snapshot_source VARCHAR(64), 
	snapshot_count INTEGER, 
	after_filter_count INTEGER, 
	candidate_count INTEGER NOT NULL, 
	llm_ranked BOOLEAN, 
	daily_enriched BOOLEAN, 
	source_errors_json TEXT, 
	warnings_json TEXT, 
	result_json TEXT NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_screening_run_market_created ON dsa_screening_runs (market, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_screening_runs_market ON dsa_screening_runs (market);

CREATE UNIQUE INDEX dsa_ix_dsa_screening_runs_run_id ON dsa_screening_runs (run_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_screening_runs_created_at ON dsa_screening_runs (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_screening_run_strategy_created ON dsa_screening_runs (strategy, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_screening_runs_strategy ON dsa_screening_runs (strategy);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_screening_runs_snapshot_source ON dsa_screening_runs (snapshot_source);

CREATE TABLE IF NOT EXISTS dsa_analysis_history (
	id SERIAL NOT NULL, 
	query_id VARCHAR(64), 
	code VARCHAR(10) NOT NULL, 
	name VARCHAR(50), 
	report_type VARCHAR(16), 
	sentiment_score INTEGER, 
	operation_advice VARCHAR(20), 
	trend_prediction VARCHAR(50), 
	analysis_summary TEXT, 
	raw_result TEXT, 
	news_content TEXT, 
	context_snapshot TEXT, 
	ideal_buy FLOAT, 
	secondary_buy FLOAT, 
	stop_loss FLOAT, 
	take_profit FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_analysis_history_code ON dsa_analysis_history (code);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_analysis_history_created_at ON dsa_analysis_history (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_analysis_code_time ON dsa_analysis_history (code, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_analysis_history_report_type ON dsa_analysis_history (report_type);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_analysis_history_query_id ON dsa_analysis_history (query_id);

CREATE TABLE IF NOT EXISTS dsa_backtest_summaries (
	id SERIAL NOT NULL, 
	scope VARCHAR(16) NOT NULL, 
	code VARCHAR(16), 
	eval_window_days INTEGER NOT NULL, 
	engine_version VARCHAR(16) NOT NULL, 
	computed_at TIMESTAMP WITHOUT TIME ZONE, 
	total_evaluations INTEGER, 
	completed_count INTEGER, 
	insufficient_count INTEGER, 
	long_count INTEGER, 
	cash_count INTEGER, 
	win_count INTEGER, 
	loss_count INTEGER, 
	neutral_count INTEGER, 
	direction_accuracy_pct FLOAT, 
	win_rate_pct FLOAT, 
	neutral_rate_pct FLOAT, 
	avg_stock_return_pct FLOAT, 
	avg_simulated_return_pct FLOAT, 
	stop_loss_trigger_rate FLOAT, 
	take_profit_trigger_rate FLOAT, 
	ambiguous_rate FLOAT, 
	avg_days_to_first_hit FLOAT, 
	advice_breakdown_json TEXT, 
	diagnostics_json TEXT, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_backtest_summary_scope_code_window_version UNIQUE (scope, code, eval_window_days, engine_version)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_backtest_summaries_code ON dsa_backtest_summaries (code);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_backtest_summaries_computed_at ON dsa_backtest_summaries (computed_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_backtest_summaries_scope ON dsa_backtest_summaries (scope);

CREATE TABLE IF NOT EXISTS dsa_portfolio_accounts (
	id SERIAL NOT NULL, 
	owner_id VARCHAR(64), 
	name VARCHAR(64) NOT NULL, 
	broker VARCHAR(64), 
	market VARCHAR(8) NOT NULL, 
	base_currency VARCHAR(8) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_portfolio_account_owner_active ON dsa_portfolio_accounts (owner_id, is_active);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_accounts_market ON dsa_portfolio_accounts (market);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_accounts_created_at ON dsa_portfolio_accounts (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_accounts_is_active ON dsa_portfolio_accounts (is_active);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_accounts_owner_id ON dsa_portfolio_accounts (owner_id);

CREATE TABLE IF NOT EXISTS dsa_portfolio_fx_rates (
	id SERIAL NOT NULL, 
	from_currency VARCHAR(8) NOT NULL, 
	to_currency VARCHAR(8) NOT NULL, 
	rate_date DATE NOT NULL, 
	rate FLOAT NOT NULL, 
	source VARCHAR(32) NOT NULL, 
	is_stale BOOLEAN NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_portfolio_fx_pair_date UNIQUE (from_currency, to_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_fx_rates_to_currency ON dsa_portfolio_fx_rates (to_currency);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_fx_rates_rate_date ON dsa_portfolio_fx_rates (rate_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_fx_rates_from_currency ON dsa_portfolio_fx_rates (from_currency);

CREATE TABLE IF NOT EXISTS dsa_conversation_messages (
	id SERIAL NOT NULL, 
	session_id VARCHAR(100) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	content TEXT NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_conversation_messages_session_id ON dsa_conversation_messages (session_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_conversation_messages_created_at ON dsa_conversation_messages (created_at);

CREATE TABLE IF NOT EXISTS dsa_conversation_session_states (
	session_id VARCHAR(100) NOT NULL, 
	selected_skill_ids_json TEXT NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (session_id)
);

CREATE TABLE IF NOT EXISTS dsa_conversation_summaries (
	id SERIAL NOT NULL, 
	session_id VARCHAR(100) NOT NULL, 
	summary TEXT NOT NULL, 
	covered_message_id INTEGER NOT NULL, 
	source_message_count INTEGER NOT NULL, 
	estimated_tokens INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE UNIQUE INDEX dsa_ix_dsa_conversation_summaries_session_id ON dsa_conversation_summaries (session_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_conversation_summaries_created_at ON dsa_conversation_summaries (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_conversation_summaries_updated_at ON dsa_conversation_summaries (updated_at);

CREATE TABLE IF NOT EXISTS dsa_agent_provider_turns (
	id SERIAL NOT NULL, 
	session_id VARCHAR(100) NOT NULL, 
	run_id VARCHAR(64) NOT NULL, 
	provider VARCHAR(64) NOT NULL, 
	model VARCHAR(160) NOT NULL, 
	anchor_user_message_id INTEGER NOT NULL, 
	anchor_assistant_message_id INTEGER NOT NULL, 
	messages_json TEXT NOT NULL, 
	contains_reasoning BOOLEAN NOT NULL, 
	contains_tool_calls BOOLEAN NOT NULL, 
	contains_thinking_blocks BOOLEAN NOT NULL, 
	must_roundtrip BOOLEAN NOT NULL, 
	estimated_tokens INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_created_at ON dsa_agent_provider_turns (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_agent_provider_turn_bucket ON dsa_agent_provider_turns (session_id, provider, model, must_roundtrip);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_anchor_user_message_id ON dsa_agent_provider_turns (anchor_user_message_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_run_id ON dsa_agent_provider_turns (run_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_must_roundtrip ON dsa_agent_provider_turns (must_roundtrip);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_model ON dsa_agent_provider_turns (model);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_anchor_assistant_message_id ON dsa_agent_provider_turns (anchor_assistant_message_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_provider ON dsa_agent_provider_turns (provider);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_agent_provider_turns_session_id ON dsa_agent_provider_turns (session_id);

CREATE TABLE IF NOT EXISTS dsa_llm_usage (
	id SERIAL NOT NULL, 
	call_type VARCHAR(32) NOT NULL, 
	model VARCHAR(128) NOT NULL, 
	stock_code VARCHAR(16), 
	provider VARCHAR(64), 
	prompt_tokens INTEGER NOT NULL, 
	completion_tokens INTEGER NOT NULL, 
	total_tokens INTEGER NOT NULL, 
	provider_usage_json TEXT, 
	provider_usage_schema_name VARCHAR(64), 
	provider_usage_schema_version VARCHAR(32), 
	provider_usage_observed_at VARCHAR(32), 
	normalized_prompt_tokens INTEGER, 
	normalized_completion_tokens INTEGER, 
	normalized_total_tokens INTEGER, 
	normalized_cache_read_tokens INTEGER, 
	normalized_cache_write_tokens INTEGER, 
	normalized_cache_miss_tokens INTEGER, 
	normalized_uncached_input_tokens INTEGER, 
	normalized_cache_eligible_input_tokens INTEGER, 
	normalized_cache_hit_ratio FLOAT, 
	normalized_cache_write_ratio FLOAT, 
	cache_capability VARCHAR(32), 
	cache_eligibility VARCHAR(32), 
	cache_observation VARCHAR(32), 
	estimated_prefix_tokens INTEGER, 
	provider_reported_prompt_tokens INTEGER, 
	provider_reported_cached_tokens INTEGER, 
	provider_min_cache_tokens INTEGER, 
	eligibility_confidence VARCHAR(32), 
	tokenizer_name VARCHAR(128), 
	tokenizer_version VARCHAR(64), 
	messages_hmac VARCHAR(64), 
	system_message_hmac VARCHAR(64), 
	user_message_hmac VARCHAR(64), 
	hmac_key_version VARCHAR(64), 
	hmac_domain VARCHAR(32), 
	hash_scope VARCHAR(32), 
	language VARCHAR(16), 
	market_group VARCHAR(16), 
	analysis_mode VARCHAR(64), 
	legacy_prompt_mode VARCHAR(32), 
	skill_config_hmac VARCHAR(64), 
	transport VARCHAR(64), 
	message_count INTEGER, 
	estimated_total_prompt_tokens INTEGER, 
	approx_common_prefix_chars INTEGER, 
	approx_common_prefix_tokens INTEGER, 
	known_dynamic_marker_positions TEXT, 
	called_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_llm_usage_call_type ON dsa_llm_usage (call_type);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_llm_usage_called_at ON dsa_llm_usage (called_at);

CREATE TABLE IF NOT EXISTS dsa_alert_rules (
	id SERIAL NOT NULL, 
	name VARCHAR(64) NOT NULL, 
	target_scope VARCHAR(32) NOT NULL, 
	target VARCHAR(64) NOT NULL, 
	alert_type VARCHAR(32) NOT NULL, 
	parameters TEXT NOT NULL, 
	severity VARCHAR(16) NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	source VARCHAR(16) NOT NULL, 
	cooldown_policy TEXT, 
	notification_policy TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_alert_type ON dsa_alert_rules (alert_type);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_updated_at ON dsa_alert_rules (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_alert_rule_type_target ON dsa_alert_rules (alert_type, target);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_enabled ON dsa_alert_rules (enabled);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_target ON dsa_alert_rules (target);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_target_scope ON dsa_alert_rules (target_scope);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_created_at ON dsa_alert_rules (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_severity ON dsa_alert_rules (severity);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_rules_source ON dsa_alert_rules (source);

CREATE TABLE IF NOT EXISTS dsa_alert_triggers (
	id SERIAL NOT NULL, 
	rule_id INTEGER, 
	target VARCHAR(64) NOT NULL, 
	observed_value FLOAT, 
	threshold FLOAT, 
	reason TEXT, 
	data_source VARCHAR(64), 
	data_timestamp TIMESTAMP WITHOUT TIME ZONE, 
	triggered_at TIMESTAMP WITHOUT TIME ZONE, 
	status VARCHAR(16) NOT NULL, 
	diagnostics TEXT, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_triggers_triggered_at ON dsa_alert_triggers (triggered_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_triggers_data_timestamp ON dsa_alert_triggers (data_timestamp);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_triggers_rule_id ON dsa_alert_triggers (rule_id);

CREATE INDEX IF NOT EXISTS dsa_ix_alert_trigger_rule_time ON dsa_alert_triggers (rule_id, triggered_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_triggers_status ON dsa_alert_triggers (status);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_triggers_target ON dsa_alert_triggers (target);

CREATE TABLE IF NOT EXISTS dsa_alert_notifications (
	id SERIAL NOT NULL, 
	trigger_id INTEGER, 
	channel VARCHAR(32) NOT NULL, 
	attempt INTEGER NOT NULL, 
	success BOOLEAN NOT NULL, 
	error_code VARCHAR(64), 
	retryable BOOLEAN NOT NULL, 
	latency_ms INTEGER, 
	diagnostics TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_notifications_channel ON dsa_alert_notifications (channel);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_notifications_created_at ON dsa_alert_notifications (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_notifications_success ON dsa_alert_notifications (success);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_notifications_trigger_id ON dsa_alert_notifications (trigger_id);

CREATE INDEX IF NOT EXISTS dsa_ix_alert_notification_trigger_channel ON dsa_alert_notifications (trigger_id, channel);

CREATE TABLE IF NOT EXISTS dsa_alert_cooldowns (
	id SERIAL NOT NULL, 
	rule_id INTEGER, 
	rule_key VARCHAR(255), 
	target VARCHAR(64) NOT NULL, 
	severity VARCHAR(16) NOT NULL, 
	last_triggered_at TIMESTAMP WITHOUT TIME ZONE, 
	cooldown_until TIMESTAMP WITHOUT TIME ZONE, 
	reason TEXT, 
	state VARCHAR(16) NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_alert_cooldown_rule_target_severity UNIQUE (rule_id, target, severity)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_last_triggered_at ON dsa_alert_cooldowns (last_triggered_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_rule_key ON dsa_alert_cooldowns (rule_key);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_state ON dsa_alert_cooldowns (state);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_severity ON dsa_alert_cooldowns (severity);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_cooldown_until ON dsa_alert_cooldowns (cooldown_until);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_target ON dsa_alert_cooldowns (target);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_rule_id ON dsa_alert_cooldowns (rule_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_alert_cooldowns_updated_at ON dsa_alert_cooldowns (updated_at);

CREATE TABLE IF NOT EXISTS dsa_decision_signals (
	id SERIAL NOT NULL, 
	stock_code VARCHAR(16) NOT NULL, 
	stock_name VARCHAR(64), 
	market VARCHAR(8) NOT NULL, 
	source_type VARCHAR(32) NOT NULL, 
	source_agent VARCHAR(64), 
	source_report_id INTEGER, 
	trace_id VARCHAR(64), 
	decision_profile VARCHAR(16), 
	market_phase VARCHAR(24), 
	trigger_source VARCHAR(64) NOT NULL, 
	action VARCHAR(16) NOT NULL, 
	action_label VARCHAR(32), 
	confidence FLOAT, 
	score INTEGER, 
	horizon VARCHAR(16), 
	entry_low FLOAT, 
	entry_high FLOAT, 
	stop_loss FLOAT, 
	target_price FLOAT, 
	invalidation TEXT, 
	watch_conditions TEXT, 
	reason TEXT, 
	risk_summary TEXT, 
	catalyst_summary TEXT, 
	evidence_json TEXT, 
	data_quality_summary_json TEXT, 
	plan_quality VARCHAR(16) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	expires_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	metadata_json TEXT, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_status ON dsa_decision_signals (status);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_decision_profile ON dsa_decision_signals (decision_profile);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_expires_at ON dsa_decision_signals (expires_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_market ON dsa_decision_signals (market);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_market_phase ON dsa_decision_signals (market_phase);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_created_at ON dsa_decision_signals (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_stock_code ON dsa_decision_signals (stock_code);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_trigger_source ON dsa_decision_signals (trigger_source);

CREATE INDEX IF NOT EXISTS dsa_ix_decision_signal_stock_status_time ON dsa_decision_signals (stock_code, status, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_updated_at ON dsa_decision_signals (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_decision_signal_market_status_time ON dsa_decision_signals (market, status, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_action ON dsa_decision_signals (action);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_signal_report_scope ON dsa_decision_signals (source_report_id, source_type, market, stock_code, action, horizon, market_phase);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_source_type ON dsa_decision_signals (source_type);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_signal_trace_scope ON dsa_decision_signals (trace_id, source_type, market, stock_code, action, horizon, market_phase);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_horizon ON dsa_decision_signals (horizon);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_signal_report_profile_scope ON dsa_decision_signals (source_report_id, source_type, market, stock_code, decision_profile, action, horizon, market_phase);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_source_report_id ON dsa_decision_signals (source_report_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_signal_trace_profile_scope ON dsa_decision_signals (trace_id, source_type, market, stock_code, decision_profile, action, horizon, market_phase);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_plan_quality ON dsa_decision_signals (plan_quality);

CREATE INDEX IF NOT EXISTS dsa_ix_decision_signal_market_stock_profile_created ON dsa_decision_signals (market, stock_code, decision_profile, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signals_trace_id ON dsa_decision_signals (trace_id);

CREATE TABLE IF NOT EXISTS dsa_decision_signal_outcomes (
	id SERIAL NOT NULL, 
	signal_id INTEGER NOT NULL, 
	horizon VARCHAR(16) NOT NULL, 
	engine_version VARCHAR(32) NOT NULL, 
	eval_status VARCHAR(24) NOT NULL, 
	outcome VARCHAR(16), 
	direction_expected VARCHAR(16), 
	direction_correct BOOLEAN, 
	unable_reason VARCHAR(64), 
	anchor_date DATE, 
	eval_window_days INTEGER, 
	start_price FLOAT, 
	end_close FLOAT, 
	max_high FLOAT, 
	min_low FLOAT, 
	stock_return_pct FLOAT, 
	action VARCHAR(16), 
	market VARCHAR(8), 
	market_phase VARCHAR(24), 
	source_type VARCHAR(32), 
	source_agent VARCHAR(64), 
	plan_quality VARCHAR(16), 
	data_quality_level VARCHAR(24), 
	holding_state VARCHAR(16) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_decision_signal_outcome_key UNIQUE (signal_id, horizon, engine_version)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_holding_state ON dsa_decision_signal_outcomes (holding_state);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_market ON dsa_decision_signal_outcomes (market);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_eval_status ON dsa_decision_signal_outcomes (eval_status);

CREATE INDEX IF NOT EXISTS dsa_ix_decision_signal_outcome_stats_action ON dsa_decision_signal_outcomes (engine_version, action, horizon);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_created_at ON dsa_decision_signal_outcomes (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_market_phase ON dsa_decision_signal_outcomes (market_phase);

CREATE INDEX IF NOT EXISTS dsa_ix_decision_signal_outcome_stats_market ON dsa_decision_signal_outcomes (engine_version, market, horizon);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_outcome ON dsa_decision_signal_outcomes (outcome);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_updated_at ON dsa_decision_signal_outcomes (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_source_type ON dsa_decision_signal_outcomes (source_type);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_direction_expected ON dsa_decision_signal_outcomes (direction_expected);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_source_agent ON dsa_decision_signal_outcomes (source_agent);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_horizon ON dsa_decision_signal_outcomes (horizon);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_unable_reason ON dsa_decision_signal_outcomes (unable_reason);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_plan_quality ON dsa_decision_signal_outcomes (plan_quality);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_signal_id ON dsa_decision_signal_outcomes (signal_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_anchor_date ON dsa_decision_signal_outcomes (anchor_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_data_quality_level ON dsa_decision_signal_outcomes (data_quality_level);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_action ON dsa_decision_signal_outcomes (action);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_outcomes_engine_version ON dsa_decision_signal_outcomes (engine_version);

CREATE TABLE IF NOT EXISTS dsa_decision_signal_feedback (
	id SERIAL NOT NULL, 
	signal_id INTEGER NOT NULL, 
	feedback_value VARCHAR(16) NOT NULL, 
	reason_code VARCHAR(64), 
	note TEXT, 
	source VARCHAR(16) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_feedback_created_at ON dsa_decision_signal_feedback (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_feedback_feedback_value ON dsa_decision_signal_feedback (feedback_value);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_feedback_source ON dsa_decision_signal_feedback (source);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_feedback_updated_at ON dsa_decision_signal_feedback (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_decision_signal_feedback_reason_code ON dsa_decision_signal_feedback (reason_code);

CREATE UNIQUE INDEX dsa_ix_dsa_decision_signal_feedback_signal_id ON dsa_decision_signal_feedback (signal_id);

CREATE TABLE IF NOT EXISTS dsa_intelligence_items (
	id SERIAL NOT NULL, 
	source_id INTEGER, 
	source_name VARCHAR(100), 
	source_type VARCHAR(32) NOT NULL, 
	title VARCHAR(300) NOT NULL, 
	summary TEXT, 
	url VARCHAR(1000) NOT NULL, 
	source VARCHAR(100), 
	published_at TIMESTAMP WITHOUT TIME ZONE, 
	fetched_at TIMESTAMP WITHOUT TIME ZONE, 
	scope_type VARCHAR(32) NOT NULL, 
	scope_value VARCHAR(64) NOT NULL, 
	market VARCHAR(32) NOT NULL, 
	raw_payload TEXT, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_intel_item_source_scope_url UNIQUE (source_id, url, scope_type, scope_value, market), 
	FOREIGN KEY(source_id) REFERENCES dsa_intelligence_sources (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_scope_type ON dsa_intelligence_items (scope_type);

CREATE INDEX IF NOT EXISTS dsa_ix_intel_item_fetch_time ON dsa_intelligence_items (fetched_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_url ON dsa_intelligence_items (url);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_source_name ON dsa_intelligence_items (source_name);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_market ON dsa_intelligence_items (market);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_source_type ON dsa_intelligence_items (source_type);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_fetched_at ON dsa_intelligence_items (fetched_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_scope_value ON dsa_intelligence_items (scope_value);

CREATE INDEX IF NOT EXISTS dsa_ix_intel_item_scope_time ON dsa_intelligence_items (scope_type, scope_value, market, published_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_published_at ON dsa_intelligence_items (published_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_intelligence_items_source_id ON dsa_intelligence_items (source_id);

CREATE TABLE IF NOT EXISTS dsa_backtest_results (
	id SERIAL NOT NULL, 
	analysis_history_id INTEGER NOT NULL, 
	code VARCHAR(10) NOT NULL, 
	analysis_date DATE, 
	eval_window_days INTEGER NOT NULL, 
	engine_version VARCHAR(16) NOT NULL, 
	eval_status VARCHAR(16) NOT NULL, 
	evaluated_at TIMESTAMP WITHOUT TIME ZONE, 
	operation_advice VARCHAR(20), 
	position_recommendation VARCHAR(8), 
	start_price FLOAT, 
	end_close FLOAT, 
	max_high FLOAT, 
	min_low FLOAT, 
	stock_return_pct FLOAT, 
	direction_expected VARCHAR(16), 
	direction_correct BOOLEAN, 
	outcome VARCHAR(16), 
	stop_loss FLOAT, 
	take_profit FLOAT, 
	hit_stop_loss BOOLEAN, 
	hit_take_profit BOOLEAN, 
	first_hit VARCHAR(16), 
	first_hit_date DATE, 
	first_hit_trading_days INTEGER, 
	simulated_entry_price FLOAT, 
	simulated_exit_price FLOAT, 
	simulated_exit_reason VARCHAR(24), 
	simulated_return_pct FLOAT, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_backtest_analysis_window_version UNIQUE (analysis_history_id, eval_window_days, engine_version), 
	FOREIGN KEY(analysis_history_id) REFERENCES dsa_analysis_history (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_backtest_results_evaluated_at ON dsa_backtest_results (evaluated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_backtest_results_analysis_history_id ON dsa_backtest_results (analysis_history_id);

CREATE INDEX IF NOT EXISTS dsa_ix_backtest_code_date ON dsa_backtest_results (code, analysis_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_backtest_results_analysis_date ON dsa_backtest_results (analysis_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_backtest_results_code ON dsa_backtest_results (code);

CREATE TABLE IF NOT EXISTS dsa_portfolio_trades (
	id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	trade_uid VARCHAR(128), 
	symbol VARCHAR(16) NOT NULL, 
	market VARCHAR(8) NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	trade_date DATE NOT NULL, 
	side VARCHAR(8) NOT NULL, 
	quantity FLOAT NOT NULL, 
	price FLOAT NOT NULL, 
	fee FLOAT, 
	tax FLOAT, 
	note VARCHAR(255), 
	dedup_hash VARCHAR(64), 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_portfolio_trade_uid UNIQUE (account_id, trade_uid), 
	CONSTRAINT dsa_uix_portfolio_trade_dedup_hash UNIQUE (account_id, dedup_hash), 
	FOREIGN KEY(account_id) REFERENCES dsa_portfolio_accounts (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_trades_dedup_hash ON dsa_portfolio_trades (dedup_hash);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_trades_account_id ON dsa_portfolio_trades (account_id);

CREATE INDEX IF NOT EXISTS dsa_ix_portfolio_trade_account_date ON dsa_portfolio_trades (account_id, trade_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_trades_trade_date ON dsa_portfolio_trades (trade_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_trades_symbol ON dsa_portfolio_trades (symbol);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_trades_created_at ON dsa_portfolio_trades (created_at);

CREATE TABLE IF NOT EXISTS dsa_portfolio_cash_ledger (
	id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	event_date DATE NOT NULL, 
	direction VARCHAR(8) NOT NULL, 
	amount FLOAT NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	note VARCHAR(255), 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(account_id) REFERENCES dsa_portfolio_accounts (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_cash_ledger_account_id ON dsa_portfolio_cash_ledger (account_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_cash_ledger_created_at ON dsa_portfolio_cash_ledger (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_portfolio_cash_account_date ON dsa_portfolio_cash_ledger (account_id, event_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_cash_ledger_event_date ON dsa_portfolio_cash_ledger (event_date);

CREATE TABLE IF NOT EXISTS dsa_portfolio_corporate_actions (
	id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	symbol VARCHAR(16) NOT NULL, 
	market VARCHAR(8) NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	effective_date DATE NOT NULL, 
	action_type VARCHAR(24) NOT NULL, 
	cash_dividend_per_share FLOAT, 
	split_ratio FLOAT, 
	note VARCHAR(255), 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(account_id) REFERENCES dsa_portfolio_accounts (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_corporate_actions_account_id ON dsa_portfolio_corporate_actions (account_id);

CREATE INDEX IF NOT EXISTS dsa_ix_portfolio_ca_account_date ON dsa_portfolio_corporate_actions (account_id, effective_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_corporate_actions_effective_date ON dsa_portfolio_corporate_actions (effective_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_corporate_actions_symbol ON dsa_portfolio_corporate_actions (symbol);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_corporate_actions_created_at ON dsa_portfolio_corporate_actions (created_at);

CREATE TABLE IF NOT EXISTS dsa_portfolio_positions (
	id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	cost_method VARCHAR(8) NOT NULL, 
	symbol VARCHAR(16) NOT NULL, 
	market VARCHAR(8) NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	quantity FLOAT NOT NULL, 
	avg_cost FLOAT NOT NULL, 
	total_cost FLOAT NOT NULL, 
	last_price FLOAT NOT NULL, 
	market_value_base FLOAT NOT NULL, 
	unrealized_pnl_base FLOAT NOT NULL, 
	valuation_currency VARCHAR(8) NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_portfolio_position_account_symbol_market_currency UNIQUE (account_id, symbol, market, currency, cost_method), 
	FOREIGN KEY(account_id) REFERENCES dsa_portfolio_accounts (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_positions_account_id ON dsa_portfolio_positions (account_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_positions_updated_at ON dsa_portfolio_positions (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_positions_symbol ON dsa_portfolio_positions (symbol);

CREATE TABLE IF NOT EXISTS dsa_portfolio_daily_snapshots (
	id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	snapshot_date DATE NOT NULL, 
	cost_method VARCHAR(8) NOT NULL, 
	base_currency VARCHAR(8) NOT NULL, 
	total_cash FLOAT NOT NULL, 
	total_market_value FLOAT NOT NULL, 
	total_equity FLOAT NOT NULL, 
	unrealized_pnl FLOAT NOT NULL, 
	realized_pnl FLOAT NOT NULL, 
	fee_total FLOAT NOT NULL, 
	tax_total FLOAT NOT NULL, 
	fx_stale BOOLEAN NOT NULL, 
	payload TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_portfolio_snapshot_account_date_method UNIQUE (account_id, snapshot_date, cost_method), 
	FOREIGN KEY(account_id) REFERENCES dsa_portfolio_accounts (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_daily_snapshots_account_id ON dsa_portfolio_daily_snapshots (account_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_daily_snapshots_created_at ON dsa_portfolio_daily_snapshots (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_daily_snapshots_snapshot_date ON dsa_portfolio_daily_snapshots (snapshot_date);

CREATE TABLE IF NOT EXISTS dsa_skill_opinion_samples (
	id SERIAL NOT NULL, 
	analysis_history_id INTEGER NOT NULL, 
	stock_code VARCHAR(16) NOT NULL, 
	skill_id VARCHAR(128) NOT NULL, 
	skill_version VARCHAR(64), 
	signal VARCHAR(16) NOT NULL, 
	confidence FLOAT NOT NULL, 
	horizon VARCHAR(16), 
	data_quality_level VARCHAR(24), 
	opinion_created_at TIMESTAMP WITHOUT TIME ZONE, 
	sample_schema_version VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_skill_opinion_sample_key UNIQUE (analysis_history_id, skill_id, sample_schema_version), 
	FOREIGN KEY(analysis_history_id) REFERENCES dsa_analysis_history (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_data_quality_level ON dsa_skill_opinion_samples (data_quality_level);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_created_at ON dsa_skill_opinion_samples (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_skill_opinion_sample_stock_created ON dsa_skill_opinion_samples (stock_code, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_skill_version ON dsa_skill_opinion_samples (skill_version);

CREATE INDEX IF NOT EXISTS dsa_ix_skill_opinion_sample_skill_horizon_created ON dsa_skill_opinion_samples (skill_id, horizon, created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_analysis_history_id ON dsa_skill_opinion_samples (analysis_history_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_sample_schema_version ON dsa_skill_opinion_samples (sample_schema_version);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_horizon ON dsa_skill_opinion_samples (horizon);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_skill_id ON dsa_skill_opinion_samples (skill_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_opinion_created_at ON dsa_skill_opinion_samples (opinion_created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_stock_code ON dsa_skill_opinion_samples (stock_code);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_samples_signal ON dsa_skill_opinion_samples (signal);

CREATE TABLE IF NOT EXISTS dsa_portfolio_position_lots (
	id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	cost_method VARCHAR(8) NOT NULL, 
	symbol VARCHAR(16) NOT NULL, 
	market VARCHAR(8) NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	open_date DATE NOT NULL, 
	remaining_quantity FLOAT NOT NULL, 
	unit_cost FLOAT NOT NULL, 
	source_trade_id INTEGER, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(account_id) REFERENCES dsa_portfolio_accounts (id), 
	FOREIGN KEY(source_trade_id) REFERENCES dsa_portfolio_trades (id)
);

CREATE INDEX IF NOT EXISTS dsa_ix_portfolio_lot_account_symbol ON dsa_portfolio_position_lots (account_id, symbol);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_position_lots_updated_at ON dsa_portfolio_position_lots (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_position_lots_open_date ON dsa_portfolio_position_lots (open_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_position_lots_symbol ON dsa_portfolio_position_lots (symbol);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_portfolio_position_lots_account_id ON dsa_portfolio_position_lots (account_id);

CREATE TABLE IF NOT EXISTS dsa_skill_opinion_outcomes (
	id SERIAL NOT NULL, 
	skill_opinion_sample_id INTEGER NOT NULL, 
	horizon VARCHAR(16) NOT NULL, 
	engine_version VARCHAR(32) NOT NULL, 
	eval_status VARCHAR(24) NOT NULL, 
	outcome VARCHAR(16), 
	direction_correct BOOLEAN, 
	unable_reason VARCHAR(64), 
	analysis_date DATE, 
	start_trade_date DATE, 
	end_trade_date DATE, 
	start_price FLOAT, 
	end_close FLOAT, 
	stock_return_pct FLOAT, 
	directional_return_pct FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT dsa_uix_skill_opinion_outcome_key UNIQUE (skill_opinion_sample_id, horizon, engine_version), 
	CONSTRAINT dsa_ck_skill_opinion_outcome_horizon CHECK (horizon IN ('1d', '3d', '5d', '10d')), 
	CONSTRAINT dsa_ck_skill_opinion_outcome_eval_status CHECK (eval_status IN ('pending', 'evaluated', 'observational', 'unable')), 
	CONSTRAINT dsa_ck_skill_opinion_outcome_value CHECK (outcome IS NULL OR outcome IN ('hit', 'miss', 'observational')), 
	CONSTRAINT dsa_ck_skill_opinion_outcome_state_fields CHECK ((eval_status IN ('pending', 'unable') AND outcome IS NULL AND direction_correct IS NULL AND directional_return_pct IS NULL) OR (eval_status = 'observational' AND outcome = 'observational' AND direction_correct IS NULL AND directional_return_pct IS NULL) OR (eval_status = 'evaluated' AND outcome IN ('hit', 'miss') AND direction_correct IS NOT NULL AND directional_return_pct IS NOT NULL)), 
	FOREIGN KEY(skill_opinion_sample_id) REFERENCES dsa_skill_opinion_samples (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_horizon ON dsa_skill_opinion_outcomes (horizon);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_start_trade_date ON dsa_skill_opinion_outcomes (start_trade_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_end_trade_date ON dsa_skill_opinion_outcomes (end_trade_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_outcome ON dsa_skill_opinion_outcomes (outcome);

CREATE INDEX IF NOT EXISTS dsa_ix_skill_opinion_outcome_horizon_status ON dsa_skill_opinion_outcomes (engine_version, horizon, eval_status);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_created_at ON dsa_skill_opinion_outcomes (created_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_updated_at ON dsa_skill_opinion_outcomes (updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_analysis_date ON dsa_skill_opinion_outcomes (analysis_date);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_eval_status ON dsa_skill_opinion_outcomes (eval_status);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_skill_opinion_sample_id ON dsa_skill_opinion_outcomes (skill_opinion_sample_id);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_unable_reason ON dsa_skill_opinion_outcomes (unable_reason);

CREATE INDEX IF NOT EXISTS dsa_ix_skill_opinion_outcome_candidate ON dsa_skill_opinion_outcomes (engine_version, eval_status, updated_at);

CREATE INDEX IF NOT EXISTS dsa_ix_dsa_skill_opinion_outcomes_engine_version ON dsa_skill_opinion_outcomes (engine_version);

INSERT INTO dsa_schema_migrations (version, description, applied_at)
VALUES ('2026-08-25-supabase-baseline', 'DSA Supabase baseline schema', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
