//! Circuit Breaker Pattern
//!
//! Prevents cascading failures by temporarily disabling failing sources.
//! States: Closed (normal) -> Open (failing) -> HalfOpen (testing)
//!
//! Turkish: "Eğer bir kaynak sürekli hata veriyorsa, sistemi yormamak için
//! o kaynağı geçici olarak devre dışı bırakan bir Circuit Breaker mantığı"

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use tracing::{info, warn, debug};

/// Circuit breaker states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Normal operation - requests pass through
    Closed,
    /// Failing - requests are blocked
    Open,
    /// Testing - limited requests allowed to test recovery
    HalfOpen,
}

/// Configuration for the circuit breaker
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    /// Number of consecutive failures before opening
    pub failure_threshold: u32,
    /// Duration to keep circuit open before testing
    pub open_duration: Duration,
    /// Number of successful requests needed to close from half-open
    pub success_threshold: u32,
    /// Maximum number of requests allowed in half-open state
    pub half_open_max_requests: u32,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            open_duration: Duration::from_secs(30),
            success_threshold: 3,
            half_open_max_requests: 3,
        }
    }
}

/// Circuit breaker for a single source
pub struct CircuitBreaker {
    name: String,
    config: CircuitBreakerConfig,
    state: RwLock<CircuitState>,
    failure_count: AtomicU32,
    success_count: AtomicU32,
    half_open_requests: AtomicU32,
    last_failure_time: RwLock<Option<Instant>>,
    total_failures: AtomicU64,
    total_successes: AtomicU64,
    trips: AtomicU64,
}

impl CircuitBreaker {
    /// Creates a new circuit breaker with the given name and config
    pub fn new(name: impl Into<String>, config: CircuitBreakerConfig) -> Self {
        Self {
            name: name.into(),
            config,
            state: RwLock::new(CircuitState::Closed),
            failure_count: AtomicU32::new(0),
            success_count: AtomicU32::new(0),
            half_open_requests: AtomicU32::new(0),
            last_failure_time: RwLock::new(None),
            total_failures: AtomicU64::new(0),
            total_successes: AtomicU64::new(0),
            trips: AtomicU64::new(0),
        }
    }

    /// Creates a circuit breaker with default config
    pub fn with_defaults(name: impl Into<String>) -> Self {
        Self::new(name, CircuitBreakerConfig::default())
    }

    /// Gets the current state
    pub fn state(&self) -> CircuitState {
        *self.state.read()
    }

    /// Gets the name of this circuit breaker
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Gets circuit breaker statistics
    pub fn stats(&self) -> CircuitBreakerStats {
        CircuitBreakerStats {
            state: self.state(),
            failure_count: self.failure_count.load(Ordering::Relaxed),
            success_count: self.success_count.load(Ordering::Relaxed),
            total_failures: self.total_failures.load(Ordering::Relaxed),
            total_successes: self.total_successes.load(Ordering::Relaxed),
            trips: self.trips.load(Ordering::Relaxed),
        }
    }

    /// Checks if request is allowed to proceed
    /// Returns true if allowed, false if circuit is open
    pub fn allow_request(&self) -> bool {
        let mut state = self.state.write();
        
        match *state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                // Check if we should transition to half-open
                if let Some(last_failure) = *self.last_failure_time.read() {
                    if last_failure.elapsed() >= self.config.open_duration {
                        info!(
                            circuit = %self.name,
                            "Circuit transitioning from Open to HalfOpen"
                        );
                        *state = CircuitState::HalfOpen;
                        self.half_open_requests.store(0, Ordering::Relaxed);
                        self.success_count.store(0, Ordering::Relaxed);
                        return self.try_half_open_request();
                    }
                }
                debug!(
                    circuit = %self.name,
                    "Circuit is Open - request blocked"
                );
                false
            }
            CircuitState::HalfOpen => {
                self.try_half_open_request()
            }
        }
    }

    /// Try to allow a request in half-open state
    fn try_half_open_request(&self) -> bool {
        let current = self.half_open_requests.fetch_add(1, Ordering::Relaxed);
        if current < self.config.half_open_max_requests {
            debug!(
                circuit = %self.name,
                request_num = current + 1,
                max = self.config.half_open_max_requests,
                "Allowing half-open request"
            );
            true
        } else {
            self.half_open_requests.fetch_sub(1, Ordering::Relaxed);
            debug!(
                circuit = %self.name,
                "HalfOpen request limit reached - blocking"
            );
            false
        }
    }

    /// Records a successful request
    pub fn record_success(&self) {
        self.total_successes.fetch_add(1, Ordering::Relaxed);
        
        let mut state = self.state.write();
        
        match *state {
            CircuitState::Closed => {
                // Reset failure count on success
                self.failure_count.store(0, Ordering::Relaxed);
            }
            CircuitState::HalfOpen => {
                let successes = self.success_count.fetch_add(1, Ordering::Relaxed) + 1;
                
                if successes >= self.config.success_threshold {
                    info!(
                        circuit = %self.name,
                        successes = successes,
                        "Circuit recovered - transitioning to Closed"
                    );
                    *state = CircuitState::Closed;
                    self.failure_count.store(0, Ordering::Relaxed);
                    self.success_count.store(0, Ordering::Relaxed);
                } else {
                    debug!(
                        circuit = %self.name,
                        successes = successes,
                        threshold = self.config.success_threshold,
                        "HalfOpen success recorded"
                    );
                }
            }
            CircuitState::Open => {
                // Shouldn't happen, but reset to closed
                *state = CircuitState::Closed;
                self.failure_count.store(0, Ordering::Relaxed);
            }
        }
    }

    /// Records a failed request
    pub fn record_failure(&self) {
        self.total_failures.fetch_add(1, Ordering::Relaxed);
        *self.last_failure_time.write() = Some(Instant::now());
        
        let mut state = self.state.write();
        
        match *state {
            CircuitState::Closed => {
                let failures = self.failure_count.fetch_add(1, Ordering::Relaxed) + 1;
                
                if failures >= self.config.failure_threshold {
                    warn!(
                        circuit = %self.name,
                        failures = failures,
                        threshold = self.config.failure_threshold,
                        open_duration_secs = self.config.open_duration.as_secs(),
                        "Circuit tripped - transitioning to Open"
                    );
                    *state = CircuitState::Open;
                    self.trips.fetch_add(1, Ordering::Relaxed);
                } else {
                    debug!(
                        circuit = %self.name,
                        failures = failures,
                        threshold = self.config.failure_threshold,
                        "Failure recorded"
                    );
                }
            }
            CircuitState::HalfOpen => {
                warn!(
                    circuit = %self.name,
                    "Failure in HalfOpen state - transitioning back to Open"
                );
                *state = CircuitState::Open;
                self.trips.fetch_add(1, Ordering::Relaxed);
                self.success_count.store(0, Ordering::Relaxed);
            }
            CircuitState::Open => {
                // Already open, just record the failure time
            }
        }
    }

    /// Manually trips the circuit (for testing or manual intervention)
    pub fn trip(&self) {
        let mut state = self.state.write();
        if *state != CircuitState::Open {
            warn!(circuit = %self.name, "Circuit manually tripped");
            *state = CircuitState::Open;
            *self.last_failure_time.write() = Some(Instant::now());
            self.trips.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Manually resets the circuit (for testing or manual intervention)
    pub fn reset(&self) {
        let mut state = self.state.write();
        info!(circuit = %self.name, "Circuit manually reset");
        *state = CircuitState::Closed;
        self.failure_count.store(0, Ordering::Relaxed);
        self.success_count.store(0, Ordering::Relaxed);
        self.half_open_requests.store(0, Ordering::Relaxed);
    }
}

/// Statistics for a circuit breaker
#[derive(Debug, Clone)]
pub struct CircuitBreakerStats {
    pub state: CircuitState,
    pub failure_count: u32,
    pub success_count: u32,
    pub total_failures: u64,
    pub total_successes: u64,
    pub trips: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_breaker_closed_to_open() {
        let config = CircuitBreakerConfig {
            failure_threshold: 3,
            open_duration: Duration::from_millis(100),
            success_threshold: 2,
            half_open_max_requests: 2,
        };
        
        let cb = CircuitBreaker::new("test", config);
        
        assert_eq!(cb.state(), CircuitState::Closed);
        assert!(cb.allow_request());
        
        // Record failures
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);
        
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
        assert!(!cb.allow_request());
    }

    #[test]
    fn test_circuit_breaker_recovery() {
        let config = CircuitBreakerConfig {
            failure_threshold: 2,
            open_duration: Duration::from_millis(10),
            success_threshold: 2,
            half_open_max_requests: 3,
        };
        
        let cb = CircuitBreaker::new("test", config);
        
        // Trip the circuit
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
        
        // Wait for open duration
        std::thread::sleep(Duration::from_millis(20));
        
        // Should transition to half-open
        assert!(cb.allow_request());
        assert_eq!(cb.state(), CircuitState::HalfOpen);
        
        // Record successes to close
        cb.record_success();
        assert_eq!(cb.state(), CircuitState::HalfOpen);
        
        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn test_circuit_breaker_half_open_failure() {
        let config = CircuitBreakerConfig {
            failure_threshold: 2,
            open_duration: Duration::from_millis(10),
            success_threshold: 2,
            half_open_max_requests: 3,
        };
        
        let cb = CircuitBreaker::new("test", config);
        
        // Trip the circuit
        cb.record_failure();
        cb.record_failure();
        
        // Wait and transition to half-open
        std::thread::sleep(Duration::from_millis(20));
        assert!(cb.allow_request());
        
        // Failure in half-open should go back to open
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
    }
}
