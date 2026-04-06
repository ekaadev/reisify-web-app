# XP & Gamification

## Overview

The XP Ranking system is the primary differentiator of this platform. It measures and rewards quality participation rather than quantity, serving dual purposes: intrinsic motivation via badges/leaderboard, and actionable assessment data for presenters/educators. The scoring design intentionally resists spam by weighting peer validation and presenter validation most heavily.

## Architecture

- **Controller:** `internal/delivery/http/xp_transaction_controller.go`
- **Use Case:** `internal/usecase/xp_transaction_usecase.go`
- **Repository:** `internal/repository/xp_transaction_repository.go`
- **Entity:** `internal/entity/xp_transaction_entity.go`
- **Model/DTO:** `internal/model/xp_transaction_model.go`
- **Leaderboard:** handled by `internal/usecase/participant_usecase.go` + `internal/repository/participant_repository.go`

## Data Model

### XPTransaction Entity (`xp_transactions` table)

| Field         | Type      | Notes                                                                                            |
| ------------- | --------- | ------------------------------------------------------------------------------------------------ |
| ID            | uint      | Primary key                                                                                      |
| ParticipantID | uint      | FK → participants.id, indexed                                                                    |
| RoomID        | uint      | FK → rooms.id, indexed                                                                           |
| Points        | int       | Positive or negative                                                                             |
| SourceType    | enum      | `poll`, `question_created`, `upvote_received`, `presenter_validated`, `message_created`, indexed |
| SourceID      | uint      | Polymorphic ID of source entity                                                                  |
| CreatedAt     | time.Time | Indexed                                                                                          |

### XP Score on Participant

`participants.xp_score` is a denormalized running total, updated atomically via:

```go
XPTransactionRepository.AddXP(tx, participantID, points)
// Executes: UPDATE participants SET xp_score = xp_score + ? WHERE id = ?
```

## XP Point Table

| Action              | Points | Recipient       | Source Type           | Notes                    |
| ------------------- | ------ | --------------- | --------------------- | ------------------------ |
| Submit question     | +10    | Author          | `question_created`    | On Q&A submit            |
| Receive upvote      | +3     | Question author | `upvote_received`     | Not the voter            |
| Upvote removed      | -3     | Question author | `upvote_received`     | Reversal                 |
| Presenter validates | +25    | Question author | `presenter_validated` | Highest weight, one-time |
| Vote on poll        | +5     | Voter           | `poll`                | Participation XP         |
| Send message        | +1     | Sender          | `message_created`     | Low weight               |

## API Endpoints

### GET /api/v1/rooms/:room_id/xp-transactions

- **Auth:** Required
- **Query Params:** `limit` (optional, default 50)
- **Response:**

```json
{
  "transactions": [
    { "id", "points", "sourceType", "sourceID", "createdAt" }
  ],
  "totalXP": 45,
  "total": 8
}
```

- **Logic:** Returns XP transaction history for the current participant in the room, ordered by `created_at DESC`

### GET /api/v1/rooms/:room_id/leaderboard

- **Auth:** Required
- **Response:**

```json
{
  "leaderboard": [
    { "rank", "participant": { "id", "displayName" }, "xpScore", "isAnonymous" }
  ],
  "myRank": { "rank", "xpScore" },
  "totalParticipants": 24
}
```

- **Logic:**
  - Top 10 participants by `xp_score DESC` from `participants` table
  - Caller's rank: `SELECT COUNT(*) FROM participants WHERE room_id = ? AND xp_score > callerXP` → rank = count + 1

## WebSocket Events

| Event                 | Direction       | Payload                                           |
| --------------------- | --------------- | ------------------------------------------------- |
| `leaderboard:updated` | Server → Client | Full leaderboard response                         |
| `leaderboard:request` | Client → Server | Empty — requests current leaderboard              |
| `xp:awarded`          | Server → Client | `{ participantID, points, newTotal, sourceType }` |

### Leaderboard Broadcast Trigger

After each XP-awarding action, controllers call `broadcastLeaderboardUpdate(hub, roomID)` to push the updated leaderboard to all room clients.

## Business Rules

- XP is room-scoped: a participant's `xp_score` is per-room, not global
- Negative XP transactions are possible (upvote removal = -3 XP to question author)
- XP score is a denormalized field on `participants`; the source of truth is `xp_transactions` (the sum should match)
- `AddXP` is always called within a DB transaction alongside the action that triggered it
- Leaderboard is not paginated — always returns top 10 only
- A participant's own rank is computed separately even if they're outside the top 10
- XP transactions cannot be modified or deleted after creation

## Reward System (Future/Design Intent)

Per the product design, XP enables two reward paths:

1. **Academic/Assessment Data** — presenter can export XP data as participation grades
2. **Intrinsic Badges** — digital badges for participation milestones (not yet implemented in current codebase)
