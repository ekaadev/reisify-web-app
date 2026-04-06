# Polling

## Overview

Allows presenters to create multiple-choice questions that the audience can answer in real time. Serves as an instant comprehension check tool and opinion gathering mechanism. Poll participation awards XP (low weight), positioning it as basic participation rather than quality contribution.

## Architecture

- **Controller:** `internal/delivery/http/poll_controller.go`
- **Use Case:** `internal/usecase/poll_usecase.go`
- **Repository:** `internal/repository/poll_repository.go`, `internal/repository/poll_option_repository.go`, `internal/repository/poll_response_repository.go`
- **Entity:** `internal/entity/poll_entity.go`, `internal/entity/poll_option_entity.go`, `internal/entity/poll_response_entity.go`
- **Model/DTO:** `internal/model/poll_model.go`
- **Converter:** `internal/model/converter/poll_converter.go`

## Data Model

### Poll Entity (`polls` table)

| Field       | Type        | Notes                                |
| ----------- | ----------- | ------------------------------------ |
| ID          | uint        | Primary key                          |
| RoomID      | uint        | FK → rooms.id, indexed               |
| Question    | text        | Poll question text                   |
| Status      | enum        | `draft`, `active`, `closed`, indexed |
| CreatedAt   | time.Time   | Indexed                              |
| ActivatedAt | \*time.Time | Nullable, when poll became active    |
| ClosedAt    | \*time.Time | Nullable, when poll was closed       |

### PollOption Entity (`poll_options` table)

| Field      | Type   | Notes                               |
| ---------- | ------ | ----------------------------------- |
| ID         | uint   | Primary key                         |
| PollID     | uint   | FK → polls.id, indexed              |
| OptionText | string | Max 255 chars                       |
| VoteCount  | uint   | Denormalized, managed by DB trigger |
| Order      | uint8  | Display order, indexed              |

### PollResponse Entity (`poll_responses` table)

| Field         | Type      | Notes                                                       |
| ------------- | --------- | ----------------------------------------------------------- |
| ID            | uint      | Primary key                                                 |
| PollID        | uint      | FK → polls.id, indexed                                      |
| ParticipantID | uint      | FK → participants.id, indexed                               |
| PollOptionID  | uint      | FK → poll_options.id, indexed                               |
| CreatedAt     | time.Time | Indexed                                                     |
| Unique        | —         | (PollID, ParticipantID) — one vote per participant per poll |

## API Endpoints

### POST /api/v1/rooms/:room_id/polls

- **Auth:** Required (presenter only)
- **Request:** `{ question: string, options: string[] }`
- **Response:** `{ poll: PollResponse }`
- **Logic:**
  - Validate caller is room presenter
  - Validate room is active
  - Create poll and options in a transaction
  - Poll status starts as `active` immediately on creation
  - Broadcast `poll:created`

### GET /api/v1/rooms/:room_id/polls/active

- **Auth:** Required
- **Response:** `{ polls: PollResponse[] }`
- **Logic:**
  - Returns all polls with status=active
  - Includes options with vote counts and percentages
  - Sets `hasVoted: bool` and `myVoteID` for current participant

### GET /api/v1/rooms/:room_id/polls

- **Auth:** Required
- **Query Params:** `status` (optional filter), `limit` (default 10)
- **Response:** `{ polls: PollResponse[], total: int }`

### POST /api/v1/polls/:poll_id/vote

- **Auth:** Required
- **Request:** `{ optionID: uint }`
- **Response:** `{ response: PollResponseResponse, updatedResults: UpdatedPollResultsResponse, xpEarned: { points, newTotal } }`
- **Logic:**
  - Validate poll is active
  - Validate option belongs to this poll
  - Validate participant hasn't already voted (unique constraint)
  - Validate participant is in same room as poll
  - Create PollResponse; DB trigger increments `poll_options.vote_count`
  - Award 5 XP to voter
  - Broadcast `poll:results_updated`

### PATCH /api/v1/polls/:poll_id/close

- **Auth:** Required (presenter only)
- **Response:** `{ poll: { id, status, closedAt, finalResults } }`
- **Logic:**
  - Validate caller is room presenter
  - Set status=closed, closedAt=NOW()
  - Broadcast `poll:closed`

## WebSocket Events

| Event                  | Direction       | Payload                                                                  |
| ---------------------- | --------------- | ------------------------------------------------------------------------ |
| `poll:created`         | Server → Client | `PollResponse` with options                                              |
| `poll:vote`            | Client → Server | `{ pollID, optionID }` (note: voting is HTTP-based, WS is informational) |
| `poll:results_updated` | Server → Client | `{ pollID, totalVotes, options: [{ id, voteCount, percentage }] }`       |
| `poll:closed`          | Server → Client | `{ poll: { id, status, closedAt, finalResults } }`                       |

## XP Logic

| Action       | XP   | Recipient | Source Type |
| ------------ | ---- | --------- | ----------- |
| Vote on poll | 5 XP | Voter     | `poll`      |

## Business Rules

- Only the room presenter can create or close polls
- Poll is created with status `active` immediately (no draft state in practice)
- A participant can only vote once per poll (DB unique constraint + application check)
- An option must belong to the poll being voted on (validated before creating PollResponse)
- Presenter and participant must be in the same room (validated via room_id)
- `vote_count` on poll options is managed by DB triggers; the app does NOT manually update it
- Percentage calculation: `(optionVoteCount / totalVotes) * 100`, returned in responses
- Poll status lifecycle: `active` → `closed` (no re-opening)
