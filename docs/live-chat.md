# Live Chat

## Overview

A public discussion space where all room participants (audience and presenter) can interact informally. Designed for quick reactions, atmosphere building, and general discussion.

Chat awards **+1 XP per message** to encourage participation, but this is intentionally kept minimal compared to Q&A rewards (10 XP for submitting questions, 3 XP per upvote received, 25 XP for presenter validation) to maintain focus on quality contributions rather than chat volume.

## Architecture

- **Controller:** `internal/delivery/http/message_controller.go`
- **Use Case:** `internal/usecase/message_usecase.go`
- **Repository:** `internal/repository/message_repository.go`
- **Entity:** `internal/entity/message_entity.go`
- **Model/DTO:** `internal/model/message_model.go`
- **Converter:** `internal/model/converter/message_converter.go`

## Data Model

### Message Entity (`messages` table)

| Field         | Type      | Notes                         |
| ------------- | --------- | ----------------------------- |
| ID            | uint      | Primary key                   |
| RoomID        | uint      | FK → rooms.id, indexed        |
| ParticipantID | uint      | FK → participants.id, indexed |
| Content       | text      | Message text                  |
| CreatedAt     | time.Time | Indexed                       |

### Relationships

- Many-to-One: Message → Room
- Many-to-One: Message → Participant (preloaded in responses)

## API Endpoints

### POST /api/v1/rooms/:room_id/messages

- **Auth:** Required
- **Request:** `{ content: string }`
- **Response:** `{ id, roomID, participant: ParticipantInfo, content, createdAt }`
- **Logic:**
  1. Validate room and participant exist
  2. Create message record
  3. Award XP via `XPTransactionUseCase.AddXPForMessage`
  4. Preload participant relation for response
  5. Broadcast `message:new` via WebSocket

### GET /api/v1/rooms/:room_id/messages

- **Auth:** Required
- **Query Params:** `limit` (optional), `before` (optional, timestamp cursor)
- **Response:** `{ messages: MessageResponse[], hasMore: bool }`
- **Logic:** Cursor-based pagination using message ID; ordered by `created_at DESC`

## WebSocket Events

| Event          | Direction       | Payload                                   |
| -------------- | --------------- | ----------------------------------------- |
| `message:send` | Client → Server | `{ content: string }`                     |
| `message:new`  | Server → Client | Full `MessageResponse`                    |
| `chat:typing`  | Bidirectional   | `{ displayName: string, isTyping: bool }` |

### Typing Indicator Flow

- Client sends `chat:typing` with `isTyping: true` when typing
- EventHandler broadcasts to all other clients in the room
- Client sends `chat:typing` with `isTyping: false` when done (or on timeout)

## Business Rules

- Messages can be sent via HTTP (`POST /messages`) or WebSocket (`message:send`)
- WebSocket send goes through `EventHandler.handleMessageSend()` which calls `MessageUseCase.Send`
- Pagination uses cursor-based approach (before message ID), not page-based
- `hasMore` is true if more messages exist before the oldest returned message
- Participant relation is always preloaded for display name resolution
- No moderation, editing, or deletion of messages

## XP Logic

| Action       | XP   | Source Type       |
| ------------ | ---- | ----------------- |
| Send message | 1 XP | `message_created` |

XP awarded via `XPTransactionUseCase.AddXPForMessage(tx, roomID, participantID, messageID)`.
