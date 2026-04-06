# Participants

## Overview

Participants represent users within a specific room. A registered user joins a room and receives a room-scoped JWT. Anonymous users also join as participants. The participant entity tracks XP score and serves as the identity for all in-room activity (questions, votes, messages).

## Architecture

- **Controller:** `internal/delivery/http/participant_controller.go`
- **Use Case:** `internal/usecase/participant_usecase.go`
- **Repository:** `internal/repository/participant_repository.go`
- **Entity:** `internal/entity/participant_entity.go`
- **Model/DTO:** `internal/model/participant_model.go`
- **Converter:** `internal/model/converter/participant_converter.go`

## Data Model

### Participant Entity (`participants` table)

| Field       | Type      | Notes                                        |
| ----------- | --------- | -------------------------------------------- |
| ID          | uint      | Primary key                                  |
| RoomID      | uint      | FK → rooms.id, indexed                       |
| UserID      | \*uint    | FK → users.id, nullable (null for anonymous) |
| DisplayName | string    | Max 100 chars                                |
| XPScore     | uint      | Total accumulated XP in this room, indexed   |
| IsAnonymous | \*bool    | Default true                                 |
| JoinedAt    | time.Time | Indexed                                      |

## API Endpoints

### POST /api/v1/rooms/:room_code/join

- **Auth:** Required (registered user)
- **Request:** `{ displayName? }` (optional display name override)
- **Response:** `{ participant: ParticipantResponse, token: string }`
- **Logic:**
  1. Find room by code
  2. Check if user already has a participant record in this room (idempotent)
  3. If not, create participant; if yes, return existing
  4. Determine `IsRoomOwner` (participant.UserID == room.PresenterID)
  5. Issue new room-scoped JWT with `RoomID`, `ParticipantID`, `IsRoomOwner`

### GET /api/v1/rooms/:room_id/participants

- **Auth:** Required
- **Query Params:** `page` (default 1), `size` (default 10)
- **Response:** `{ participants: ParticipantListItem[], paging: PaginationResponse }`

### GET /api/v1/rooms/:room_id/leaderboard

- **Auth:** Required
- **Response:** `{ leaderboard: LeaderboardEntry[], myRank: MyRank, totalParticipants: int }`
- **Logic:**
  - Returns top 10 participants sorted by `xp_score DESC`
  - Calculates caller's rank: `COUNT(participants with higher XP) + 1`

## WebSocket Events

| Event              | Direction       | Payload                           |
| ------------------ | --------------- | --------------------------------- |
| `room:join`        | Server → Client | Sent to connecting client only    |
| `room:user_joined` | Server → Client | Broadcast to all in room          |
| `room:user_left`   | Server → Client | Broadcast when client disconnects |

## Business Rules

- `Join` is idempotent: if the user already has a participant in this room, returns the existing record with a fresh token
- Presenter is auto-enrolled on room creation (via `RoomUseCase.Create`)
- Anonymous users join via `POST /api/v1/users/anonymous` (not this endpoint); they get a participant but no user account
- `IsRoomOwner` is determined by comparing `participant.UserID` with `room.PresenterID`
- `XPScore` is a denormalized sum on the participant row, updated atomically via `XPTransactionRepository.AddXP`
- Leaderboard is limited to top 10; rank for participants outside top 10 is calculated separately

## Response Structures

```go
ParticipantResponse {
    ID          uint
    RoomID      uint
    DisplayName string
    XPScore     uint
    IsAnonymous bool
    RoomRole    string  // "host" | "audience"
    JoinedAt    time.Time
}

LeaderboardEntry {
    Rank        int
    Participant ParticipantInfo
    XPScore     uint
    IsAnonymous bool
}

MyRank {
    Rank    int
    XPScore uint
}
```
