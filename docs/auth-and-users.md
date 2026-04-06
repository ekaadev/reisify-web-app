# Auth & Users

## Overview

Handles user registration, authentication, anonymous access, and session management. Supports two user types: registered presenters and anonymous participants. All authentication is JWT-based with Redis token blacklisting for logout. Tokens are transported as HTTP-only cookies (not Authorization headers).

## Architecture

- **Controller:** `internal/delivery/http/user_controller.go`
- **Use Case:** `internal/usecase/user_usecase.go`
- **Repository:** `internal/repository/user_repository.go`
- **Entity:** `internal/entity/user_entity.go`
- **Middleware:** `internal/delivery/http/middleware/auth_middleware.go`
- **Model/DTO:** `internal/model/user_model.go`, `internal/model/auth.go`
- **Converter:** `internal/model/converter/user_converter.go`

## Data Model

### User Entity (`users` table)

| Field        | Type      | Notes                  |
| ------------ | --------- | ---------------------- |
| ID           | uint      | Primary key            |
| Username     | string    | Unique, max 100 chars  |
| Email        | string    | Unique, max 255 chars  |
| PasswordHash | string    | bcrypt hash            |
| Role         | enum      | `presenter` or `admin` |
| CreatedAt    | time.Time | Auto                   |
| UpdatedAt    | time.Time | Auto                   |

### JWT Claims (`model.Auth`)

```go
type Auth struct {
    UserID        *uint
    ParticipantID *uint
    RoomID        *uint
    Username      string
    DisplayName   string
    Email         string
    Role          string  // presenter | admin | anonymous
    IsAnonymous   bool
    IsRoomOwner   bool
    jwt.RegisteredClaims
}
```

After joining a room, `RoomID`, `ParticipantID`, and `IsRoomOwner` are populated in a new token.

## API Endpoints

### POST /api/v1/users/register

- **Auth:** None
- **Rate limit:** 10 req/min per IP
- **Request:** `{ username, email, password, role }`
- **Response:** `{ user: UserResponse }` — JWT set as `token` HTTP-only cookie
- **Logic:** Hash password with bcrypt, check uniqueness of email/username, create user, set auth cookie

### POST /api/v1/users/login

- **Auth:** None
- **Rate limit:** 10 req/min per IP
- **Request:** `{ username, password }`
- **Response:** `{ user: UserResponse }` — JWT set as `token` HTTP-only cookie
- **Logic:** Find user by username, compare bcrypt hash, set auth cookie

### POST /api/v1/users/anonymous

- **Auth:** None
- **Rate limit:** 10 req/min per IP
- **Request:** `{ roomCode, displayName }`
- **Response:** `{ participant: ParticipantResponse }` — room-scoped JWT set as `token` HTTP-only cookie
- **Logic:** Find room by code, create anonymous participant (no user_id), set auth cookie

### POST /api/v1/users/logout

- **Auth:** Required (cookie)
- **Request:** None
- **Response:** `{ data: null }`
- **Logic:** Blacklist current JWT in Redis; clears the `token` cookie; subsequent requests return 401

## Business Rules

- Email and username must be unique; returns 409 conflict if taken
- Anonymous users are created as participants directly — no `users` table entry
- Anonymous JWT has `IsAnonymous: true`, no `UserID`
- Logout blacklists the exact token string in Redis (TTL = token expiry) and clears the auth cookie
- All routes except register, login, anonymous, and room lookup require the `token` cookie

## Auth Middleware

Tokens are read from the `token` HTTP-only cookie set on login/register/anonymous.

Middleware (`NewAuth()`) validates the cookie token and sets `ctx.Locals("auth", *model.Auth)`.
Use `middleware.GetUser(c)` in controllers to retrieve the claims.

Cookie attributes:

- `HttpOnly: true` — not accessible to JavaScript
- `Secure`: controlled by `COOKIE_SECURE` env var (false for local dev, true in production)
- `SameSite: Lax`
- `MaxAge`: 30 days (matching JWT expiry)

Returns `401 Unauthorized` if:

- Cookie is missing
- Token is invalid or expired
- Token is blacklisted in Redis
