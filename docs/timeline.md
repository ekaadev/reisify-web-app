# Timeline (Unified Activity Feed)

## Overview

The timeline provides a single chronological feed of all activity in a room: messages, questions, and polls merged together. Designed as a unified view of what happened in the room, useful for latecomers or post-session review.

## Architecture

- **Controller:** `internal/delivery/http/activity_controller.go`
- **Use Case:** `internal/usecase/activity_usecase.go`
- **Repository:** `internal/repository/activity_repository.go`
- **Model/DTO:** `internal/model/activity_model.go`

## Data Model

### Activity Types

```go
const (
    ActivityTypeMessage      = "message"
    ActivityTypeQuestion     = "question"
    ActivityTypePoll         = "poll"
    ActivityTypeAnnouncement = "announcement"
)
```

### TimelineItem Structure

```go
TimelineItem {
    Type      string      // "message" | "question" | "poll" | "announcement"
    ID        uint        // Source entity ID
    CreatedAt time.Time
    Data      interface{} // Type-specific data (see below)
}
```

### Type-Specific Data

**Message (`MessageTimelineData`):**

```json
{ "content": "...", "participant": { "id", "displayName" } }
```

**Question (`QuestionTimelineData`):**

```json
{ "content": "...", "participant": { "id", "displayName" }, "upvoteCount", "isValidated", "status" }
```

**Poll (`PollTimelineData`):**

```json
{ "question": "...", "status": "active|closed", "options": [...], "totalVotes" }
```

**Announcement (`AnnouncementTimelineData`):**

```json
{ "message": "..." }
```

## API Endpoints

### GET /api/v1/rooms/:room_id/timeline

- **Auth:** Required
- **Query Params:**
  - `before` — RFC3339 timestamp cursor (fetch items older than this)
  - `after` — RFC3339 timestamp cursor (fetch items newer than this)
  - `limit` — default 50
- **Response:**

```json
{
  "items": [ TimelineItem... ],
  "hasMore": true,
  "oldestAt": "2024-01-01T10:00:00Z",
  "newestAt": "2024-01-01T11:00:00Z"
}
```

## Implementation Details

### UNION ALL Query

The repository executes a raw UNION ALL across three tables:

```sql
(SELECT 'message' as type, id, created_at FROM messages WHERE room_id = ?)
UNION ALL
(SELECT 'question' as type, id, created_at FROM questions WHERE room_id = ?)
UNION ALL
(SELECT 'poll' as type, id, created_at FROM polls WHERE room_id = ?)
ORDER BY created_at DESC
LIMIT ?
```

Wrapped with cursor filters when `before` or `after` are provided.

### Batch Enrichment

After fetching raw items, the use case groups IDs by type and performs batch fetches:

- `ActivityRepository.GetMessagesByIDs(db, ids)` — with Preload(Participant)
- `ActivityRepository.GetQuestionsByIDs(db, ids)` — with Preload(Participant)
- `ActivityRepository.GetPollsByIDs(db, ids)` — with Preload(Options)

Results are merged into the final `TimelineItem` array.

### Cursor Pagination

- `before` → returns items with `created_at < before` (older items)
- `after` → returns items with `created_at > after` (newer items), then reversed to maintain DESC order
- Fetches `limit + 1` items; if result count > limit, `hasMore = true` and the extra item is trimmed
- Returns `oldestAt` and `newestAt` timestamps for the client to use as next cursors

## WebSocket Events

| Event          | Direction       | Payload                                                                     |
| -------------- | --------------- | --------------------------------------------------------------------------- |
| `activity:new` | Server → Client | `TimelineItem` — broadcast when a new message, question, or poll is created |

## Business Rules

- Announcements exist only as WebSocket events (`room:announce`); they appear in the timeline as synthetic items
- Timeline is read-only; no modifications via this endpoint
- Default sort: newest first (`created_at DESC`)
- The timeline does not include vote events or XP transactions — only the originating entities
- Room must exist and be accessible to the caller
