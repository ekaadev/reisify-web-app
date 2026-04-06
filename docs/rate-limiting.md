# Rate Limiting

## Overview

Rate limiting protects the authentication endpoints from brute-force and credential-stuffing attacks. It is applied as a per-IP sliding window: each IP address is allowed a fixed number of requests per time window, and excess requests are rejected before they reach any business logic.

## What Is Rate Limited

| Endpoint                       | Limit                     |
| ------------------------------ | ------------------------- |
| `POST /api/v1/users/register`  | 10 requests / minute / IP |
| `POST /api/v1/users/login`     | 10 requests / minute / IP |
| `POST /api/v1/users/anonymous` | 10 requests / minute / IP |

When the limit is exceeded the server responds with `429 Too Many Requests`. All other endpoints are not rate limited.

## Storage Architecture

The limiter needs to store the request count for each IP. Where that count is stored determines whether the limit is enforced consistently across process restarts and (in the future) across multiple server instances.

```
Request
   |
   v
FallbackStorage.Get / .Set
   |
   +-- Is circuit open AND cooldown not elapsed?
   |       YES --> use in-memory storage
   |
   +-- NO --> try Redis
           |
           +-- Redis OK  --> record success, return result
           +-- Redis ERR --> record failure
                               |
                               +-- failures >= 3? --> open circuit, log warning
                               +-- use in-memory storage as fallback
```

### Redis (primary)

Rate limit counters are stored in Redis. This is the default when `REDIS_HOST` is configured. Redis makes the counts durable across server restarts and, if the app ever runs as multiple processes, shared across all of them.

`redisStorage` wraps the existing `go-redis` client and implements `fiber.Storage` (Get/Set/Delete). `Reset()` is intentionally a no-op — flushing a shared Redis instance would wipe unrelated keys.

### In-memory (fallback)

`memoryStorage` implements `fiber.Storage` using a `sync.Map`. Entries carry an expiry timestamp and are lazily evicted on read. This is used when:

- Redis is not configured (`REDIS_HOST` is unset) — the server starts without a Redis client and memory is the only storage available.
- The circuit breaker is open (Redis is unreachable) — the server continues enforcing limits without Redis.

In-memory counts are process-local: they reset on restart and are not shared across processes. This is acceptable for single-process deployments.

## Circuit Breaker

The circuit breaker prevents every rate-limit check from blocking on a Redis timeout when Redis is down.

### States

```
         3 consecutive failures
CLOSED ─────────────────────────> OPEN
  ^                                  |
  |       probe succeeds             |   10-second cooldown
  └──────────────────────── HALF-OPEN <─┘ (one probe attempt allowed)
```

| State                 | Behavior                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Closed** (normal)   | All requests go to Redis. Failure counter is 0.                                                                                 |
| **Open**              | All requests go to in-memory. Redis is not contacted.                                                                           |
| **Half-open** (probe) | After 10 s cooldown, one request is allowed to try Redis. If it succeeds, the circuit closes. If it fails, the cooldown resets. |

### Thresholds

| Parameter                | Value | Location             |
| ------------------------ | ----- | -------------------- |
| Failures to open circuit | 3     | `NewFallbackStorage` |
| Cooldown before probe    | 10 s  | `NewFallbackStorage` |

These are compile-time constants set in `internal/delivery/http/route/ratelimiter.go`.

### What "open circuit" means in practice

When Redis goes down:

1. The first three failing requests increment the failure counter.
2. On the third failure the circuit opens and a warning is logged: `rate limiter: Redis unavailable (...), circuit opened — falling back to in-memory for 10s`.
3. All subsequent requests skip Redis and count against the in-memory store.
4. After 10 seconds a probe is sent to Redis.
5. If Redis responds, the circuit closes and a log entry is written: `rate limiter: Redis recovered, circuit closed`.

## Key Files

| File                                          | Purpose                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `internal/delivery/http/route/ratelimiter.go` | `FallbackStorage`, `redisStorage`, `memoryStorage`, circuit breaker logic |
| `internal/delivery/http/route/route.go`       | Wires storage and attaches `authLimiter` to auth endpoints                |

## Configuration

No dedicated env vars control the limiter thresholds — they are hardcoded to the values above. Redis connection is shared with JWT blacklisting and is configured via the standard Redis env vars:

```
REDIS_HOST=
REDIS_PORT=
REDIS_DB=
REDIS_PASSWORD=   # optional
```

If `REDIS_HOST` is not set, the app starts without a Redis client and rate limiting uses in-memory storage automatically.
