# Epic 10.8: Integration Testing & Metrics

This directory contains E2E tests for Epic 10 features.

## Test Structure

```
tests/
├── e2e/                           # End-to-end tests
│   ├── vector-memory.test.js      # Epic 10.5: Vector Memory Service
│   ├── pty-persistence.test.js    # Epic 10.2: PTY Session Persistence
│   ├── vram-optimization.test.js  # Epic 10.7: VRAM Optimization
│   └── ai-audit-latency.test.js   # Epic 10.3: AI Audit Performance
└── unit/                          # Unit tests (future)
```

## Running Tests

### Prerequisites

Install test dependencies:
```bash
npm install --save-dev mocha chai
```

### Run All Tests

```bash
npm test
```

### Run Specific Test Suite

```bash
npx mocha tests/e2e/vector-memory.test.js
npx mocha tests/e2e/pty-persistence.test.js
npx mocha tests/e2e/vram-optimization.test.js
npx mocha tests/e2e/ai-audit-latency.test.js
```

### Run with Coverage (Optional)

```bash
npm install --save-dev nyc
npx nyc npm test
```

## Metrics Endpoint

The MetricsService exposes Prometheus-compatible metrics at:

- **Metrics**: `http://localhost:9090/metrics`
- **Health**: `http://localhost:9090/health`

### Example Metrics Query

```bash
curl http://localhost:9090/metrics
```

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `pinokio_audit_total` | counter | Total security audits performed |
| `pinokio_audit_latency_avg` | gauge | Average audit latency (ms) |
| `pinokio_download_total` | counter | Total downloads |
| `pinokio_download_resumed` | counter | Successfully resumed downloads |
| `pinokio_vram_calculation_total` | counter | VRAM allocation calculations |
| `pinokio_vector_store_total` | counter | Memories stored |
| `pinokio_vector_search_latency_avg` | gauge | Average search latency (ms) |
| `pinokio_pty_session_restored` | counter | PTY sessions restored from disk |

## Test Coverage Goals

- **Target**: 80% code coverage for Epic 10 features
- **Focus Areas**:
  - Vector Memory: Store, search, persistence
  - PTY Persistence: Serialize, restore, edge cases
  - VRAM Optimization: GPU selection, CPU fallback
  - AI Audit: Latency, progress reporting, accuracy
  - Download Resume: HTTP Range, checksum validation

## CI/CD Integration

These tests are designed to run in CI environments. For GitHub Actions:

```yaml
- name: Run E2E Tests
  run: npm test
  env:
    NODE_ENV: test
```

## Notes

- Some tests (e.g., AI Audit) require network access and may be slower
- GPU-related tests will gracefully handle systems without NVIDIA GPUs
- Vector Memory tests create temporary data that is cleaned up automatically
