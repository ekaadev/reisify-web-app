# Rooms

## Overview

Rooms are the core container for all activity. A presenter creates a room and participants join via a room code. Rooms have a simple lifecycle: active → closed → deleted. Only one presenter owns a room, and they have elevated privileges for all room-scoped actions.

## Architecture

- **Controller:** `internal/delivery/http/room_controller.go`
- **Use Case:** `internal/usecase/room_usecase.go`
- **Repository:** `internal/repository/room_repository.go`
- **Entity:** `internal/entity/room_entity.go`
- **Model/DTO:** `internal/model/room_model.go`
- **Converter:** `internal/model/converter/room_converter.go`

## Data Model

### Room Entity (`rooms` table)

| Field       | Type        | Notes                                        |
| ----------- | ----------- | -------------------------------------------- |
| ID          | uint        | Primary key                                  |
| RoomCode    | string      | Unique, 6 chars, cryptographically generated |
| Title       | string      | Max 255 chars                                |
| PresenterID | uint        | FK → users.id, indexed                       |
| Status      | enum        | `active` or `closed`                         |
| CreatedAt   | time.Time   | Indexed                                      |
| ClosedAt    | \*time.Time | Nullable, set on close                       |

### Room Stats (in RoomDetailResponse)

- `totalParticipants` — count from participants table
- `totalQuestions` — count from questions table
- `totalPolls` — count from polls table
- `activePollID` — ID of current active poll (if any)

## API Endpoints

### POST /api/v1/rooms

- **Auth:** Required
- **Request:** `{ title }`
- **Response:** `{ room: RoomResponse, participantID: uint }`
- **Logic:** Generate unique 6-char room code via `crypto/rand`; create room; auto-enroll presenter as participant; returns room data + presenter's participantID

### GET /api/v1/rooms/:room_code

- **Auth:** None (public)
- **Response:** `RoomDetailResponse` with stats and presenter info
- **Logic:** Find by room code; preload associations

### PATCH /api/v1/rooms/:room_id/close

- **Auth:** Required (presenter only)
- **Response:** `{ id, status, closedAt }`
- **Logic:** Validate caller is room presenter; set status=closed, closedAt=NOW()

### DELETE /api/v1/rooms/:room_id

- **Auth:** Required (presenter only)
- **Business Rule:** Room must be closed before it can be deleted
- **Logic:** Soft delete via GORM (sets deleted_at)

### GET /api/v1/users/me/rooms

- **Auth:** Required
- **Response:** `{ rooms: RoomListItem[] }`
- **Logic:** Fetch all rooms where presenter_id = caller's UserID

### POST /api/v1/rooms/:room_id/announcement

- **Auth:** Required (presenter only)
- **Request:** `{ message: string }`
- **Response:** `{ data: null }`
- **Logic:** Broadcast `room:announce` WebSocket event to all connected clients in the room

## WebSocket Events

| Event              | Direction       | Payload                   |
| ------------------ | --------------- | ------------------------- |
| `room:announce`    | Server → Client | `{ message: string }`     |
| `room:closed`      | Server → Client | `{ roomID: uint }`        |
| `room:user_joined` | Server → Client | Participant info          |
| `room:user_left`   | Server → Client | `{ participantID: uint }` |

## Business Rules

- Room code is 6 characters, generated using `crypto/rand` for uniqueness
- Presenter is auto-enrolled as a participant when creating a room (so they get a participantID and can use WebSocket)
- Only the room presenter can close, delete, or send announcements
- A room must be `closed` before it can be deleted
- `GET /rooms/:room_code` is the only public room endpoint (no auth)
- Room status transitions: `active` → `closed` (one-way, no re-opening)
