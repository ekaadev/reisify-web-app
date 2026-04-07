# WebSocket API Specification

## Connection

**Endpoint:** `GET /ws`

**Authentication:** The server prefers the JWT token from an HTTP-only cookie named `token` (same-origin browser clients). If the cookie is absent, the token may be passed as a query parameter:

```
ws://localhost:3000/ws?token={jwt_token}
```

Tokens passed via query parameter will appear in proxy and access logs; use the cookie path for browser clients. A token is issued at login or room join and must carry `RoomID` and `ParticipantID` claims.

---

## Message Format

All WebSocket messages follow this envelope:

```json
{
  "event": "event_name",
  "data": { ... }
}
```

---

## Client -> Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message:send` | `{content: string}` | Send a chat message to the room |
| `chat:typing` | `{is_typing: boolean}` | Broadcast typing indicator |
| `question:submit` | `{content: string}` | Submit a Q&A question |
| `question:upvote` | `{question_id: number}` | Upvote a question |
| `question:remove_upvote` | `{question_id: number}` | Remove an upvote |
| `leaderboard:request` | `{}` | Request leaderboard data (individual response) |
| `webrtc:offer` | `{type: "offer", sdp: string, renegotiate?: boolean, reason?: string}` | Send a WebRTC SDP offer (or renegotiation) |
| `webrtc:answer` | `{type: "answer", sdp: string}` | Send a WebRTC SDP answer |
| `webrtc:candidate` | `{candidate: string, sdpMid: string, sdpMLineIndex: number}` | Send a WebRTC ICE candidate |
| `conference:start` | `{}` | Start a conference stage (host only) |
| `conference:stop` | `{}` | Stop the conference stage (host only) |
| `conference:join` | `{}` | Join the conference as audience |
| `conference:leave` | `{}` | Leave the conference |
| `conference:raise_hand` | `{}` | Raise hand to request to speak |
| `conference:lower_hand` | `{}` | Lower a previously raised hand |
| `conference:promote` | `{participant_id: string}` | Promote a participant to speaker (host only) |
| `conference:demote` | `{participant_id: string}` | Demote a speaker back to audience (host only) |

---

## Server -> Client Events

### Room Events

#### `room:user_joined`
Broadcast to all room participants when a new client connects.
```json
{
  "event": "room:user_joined",
  "data": {
    "participant_id": 123,
    "display_name": "John Doe",
    "is_anonymous": false,
    "joined_at": "2026-01-26T08:00:00+07:00"
  }
}
```

#### `room:user_left`
Broadcast to all room participants when a client disconnects.
```json
{
  "event": "room:user_left",
  "data": {
    "participant_id": 123,
    "display_name": "John Doe",
    "left_at": "2026-01-26T08:30:00+07:00"
  }
}
```

#### `room:announce`
Broadcast when the presenter sends an announcement via `POST /api/v1/rooms/:room_id/announcement`.
```json
{
  "event": "room:announce",
  "data": {
    "message": "Announcement text from presenter",
    "announced_at": "2026-01-26T08:15:00+07:00"
  }
}
```

---

### Message Events

#### `message:send`
Broadcast to all room participants after a chat message is saved.
```json
{
  "event": "message:send",
  "data": {
    "id": 456,
    "content": "Hello everyone!",
    "participant": {
      "id": 123,
      "display_name": "John"
    },
    "created_at": "2026-01-26T08:00:00+07:00"
  }
}
```

#### `chat:typing`
Broadcast to all room participants when someone sends a typing indicator.
```json
{
  "event": "chat:typing",
  "data": {
    "participant_id": 123,
    "is_typing": true
  }
}
```

---

### Question (Q&A) Events

#### `question:created`
Broadcast to all room participants when a new question is submitted. Includes XP earned by the submitter when applicable.
```json
{
  "event": "question:created",
  "data": {
    "question": {
      "id": 789,
      "content": "What is the deadline?",
      "participant": { "id": 123, "display_name": "John" },
      "upvote_count": 0,
      "status": "pending",
      "is_validated_by_presenter": false,
      "created_at": "2026-01-26T08:00:00+07:00"
    },
    "xp_earned": {
      "points": 10,
      "new_total": 50
    }
  }
}
```
`xp_earned` is omitted if no XP was awarded.

#### `question:upvoted`
Broadcast to all room participants when a question is upvoted or an upvote is removed.
```json
{
  "event": "question:upvoted",
  "data": {
    "question": {
      "id": 789,
      "upvote_count": 5
    },
    "participant_id": 123,
    "action": "add"
  }
}
```
`action` is `"add"` for an upvote and `"remove"` for a removed upvote.

#### `question:validated`
Broadcast to all room participants when the presenter validates a question via `PATCH /api/v1/questions/:question_id/validate`. Includes XP awarded to the question author when applicable.
```json
{
  "event": "question:validated",
  "data": {
    "question": {
      "id": 789,
      "status": "answered",
      "is_validated_by_presenter": true
    },
    "xp_awarded": {
      "participant_id": 123,
      "points": 20,
      "new_total": 70
    }
  }
}
```
`xp_awarded` is omitted if no XP was awarded.

---

### Poll Events

#### `poll:created`
Broadcast to all room participants when the presenter creates a poll via `POST /api/v1/rooms/:room_id/polls`.
```json
{
  "event": "poll:created",
  "data": {
    "poll": {
      "id": 101,
      "question": "What topic should we cover next?",
      "status": "active",
      "created_at": "2026-01-26T08:00:00+07:00",
      "options": [
        { "id": 1, "option_text": "Topic A", "vote_count": 0, "order": 1 },
        { "id": 2, "option_text": "Topic B", "vote_count": 0, "order": 2 }
      ]
    }
  }
}
```

#### `poll:results_updated`
Broadcast to all room participants when a vote is submitted via `POST /api/v1/polls/:poll_id/vote`.
```json
{
  "event": "poll:results_updated",
  "data": {
    "updated_results": {
      "poll_id": 101,
      "total_votes": 8,
      "options": [
        { "id": 1, "option_text": "Topic A", "vote_count": 5, "order": 1, "percentage": 62.5 },
        { "id": 2, "option_text": "Topic B", "vote_count": 3, "order": 2, "percentage": 37.5 }
      ]
    }
  }
}
```

#### `poll:closed`
Broadcast to all room participants when the presenter closes a poll via `PATCH /api/v1/polls/:poll_id/close`.
```json
{
  "event": "poll:closed",
  "data": {
    "poll": {
      "id": 101,
      "status": "closed",
      "closed_at": "2026-01-26T09:00:00+07:00",
      "final_results": {
        "total_votes": 8,
        "options": [
          { "id": 1, "option_text": "Topic A", "vote_count": 5, "order": 1, "percentage": 62.5 },
          { "id": 2, "option_text": "Topic B", "vote_count": 3, "order": 2, "percentage": 37.5 }
        ]
      }
    }
  }
}
```

---

### Leaderboard Events

#### `leaderboard:updated` (broadcast)
Broadcast to all room participants after any XP-awarding action (message sent, question submitted, question upvoted, poll voted).
```json
{
  "event": "leaderboard:updated",
  "data": {
    "leaderboard": {
      "leaderboard": [
        {
          "rank": 1,
          "participant": { "id": 123, "display_name": "John" },
          "xp_score": 150,
          "is_anonymous": false
        },
        {
          "rank": 2,
          "participant": { "id": 456, "display_name": "Jane" },
          "xp_score": 120,
          "is_anonymous": false
        }
      ],
      "my_rank": { "rank": 1, "xp_score": 150 },
      "total_participants": 25
    },
    "total_participants": 25
  }
}
```

#### `leaderboard:updated` (individual response)
Sent only to the requesting client in response to a `leaderboard:request` event.
```json
{
  "event": "leaderboard:updated",
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "participant": { "id": 123, "display_name": "John" },
        "xp_score": 150,
        "is_anonymous": false
      }
    ],
    "my_rank": { "rank": 1, "xp_score": 150 },
    "total_participants": 25
  }
}
```

---

### WebRTC Signaling Events

These events are sent only to the requesting client, not broadcast to the room.

#### `webrtc:answer`
SDP answer from the SFU in response to a `webrtc:offer`.
```json
{
  "event": "webrtc:answer",
  "data": {
    "type": "answer",
    "sdp": "v=0\r\n..."
  }
}
```

#### `webrtc:candidate`
ICE candidate from the SFU.
```json
{
  "event": "webrtc:candidate",
  "data": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

---

### Conference Events

#### `conference:started`
Broadcast to all room participants when the host starts the conference stage.
```json
{
  "event": "conference:started",
  "data": {
    "host_id": "123",
    "is_active": true,
    "speakers": ["123"],
    "raised_hands": []
  }
}
```

#### `conference:ended`
Broadcast to all room participants when the host stops the conference stage.
```json
{
  "event": "conference:ended",
  "data": {}
}
```

#### `conference:state`
Sent only to a client that sends `conference:join`, describing the current conference state and the client's own role.
```json
{
  "event": "conference:state",
  "data": {
    "host_id": "123",
    "is_active": true,
    "speakers": ["123"],
    "raised_hands": [],
    "is_room_owner": false
  }
}
```

#### `conference:joined`
Broadcast to all room participants when a client joins the conference.
```json
{
  "event": "conference:joined",
  "data": {
    "participant_id": "456",
    "is_room_owner": false
  }
}
```

#### `conference:left`
Broadcast to all room participants when a client leaves the conference.
```json
{
  "event": "conference:left",
  "data": {
    "participant_id": "456"
  }
}
```

#### `conference:hand_raised`
Broadcast to all room participants when a participant raises their hand.
```json
{
  "event": "conference:hand_raised",
  "data": {
    "participant_id": "456",
    "timestamp": 1706256000
  }
}
```
`timestamp` is a Unix epoch integer.

#### `conference:hand_lowered`
Broadcast to all room participants when a participant lowers their hand.
```json
{
  "event": "conference:hand_lowered",
  "data": {
    "participant_id": "456"
  }
}
```

#### `conference:promoted`
Broadcast to all room participants when the host promotes a participant to speaker.
```json
{
  "event": "conference:promoted",
  "data": {
    "participant_id": "456"
  }
}
```

#### `conference:demoted`
Broadcast to all room participants when the host demotes a speaker back to audience.
```json
{
  "event": "conference:demoted",
  "data": {
    "participant_id": "456"
  }
}
```

---

## HTTP Endpoints for WebSocket Features

The following HTTP endpoints trigger WebSocket broadcasts to the room:

| Method | Endpoint | Triggers WS Event |
|--------|----------|-------------------|
| POST | `/api/v1/rooms/:room_id/announcement` | `room:announce` |
| POST | `/api/v1/rooms/:room_id/questions` | `question:created` |
| POST | `/api/v1/questions/:question_id/upvote` | `question:upvoted` |
| DELETE | `/api/v1/questions/:question_id/upvote` | `question:upvoted` |
| PATCH | `/api/v1/questions/:question_id/validate` | `question:validated` |
| POST | `/api/v1/rooms/:room_id/polls` | `poll:created` |
| POST | `/api/v1/polls/:poll_id/vote` | `poll:results_updated`, `leaderboard:updated` |
| PATCH | `/api/v1/polls/:poll_id/close` | `poll:closed` |

---

## Timeline API (Unified Activity Feed)

### GET /api/v1/rooms/:room_id/timeline

Returns messages, questions, polls, and announcements in a single chronological feed.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `before` | RFC3339 | — | Cursor to load items older than this timestamp |
| `after` | RFC3339 | — | Cursor to load items newer than this timestamp |
| `limit` | number | 50 | Number of items (max: 100) |

**Response:**
```json
{
  "data": {
    "items": [
      {
        "type": "message",
        "id": 1,
        "created_at": "2026-01-26T09:03:00Z",
        "data": {
          "content": "Hello!",
          "participant": { "id": 1, "display_name": "John" }
        }
      },
      {
        "type": "poll",
        "id": 2,
        "created_at": "2026-01-26T09:02:00Z",
        "data": {
          "question": "Choose topic",
          "status": "active",
          "options": [],
          "total_votes": 0
        }
      },
      {
        "type": "question",
        "id": 5,
        "created_at": "2026-01-26T09:01:00Z",
        "data": {
          "content": "What is...?",
          "participant": { "id": 2, "display_name": "Jane" },
          "upvote_count": 3,
          "is_validated": false,
          "status": "pending"
        }
      },
      {
        "type": "announcement",
        "id": 7,
        "created_at": "2026-01-26T09:00:00Z",
        "data": {
          "message": "Welcome everyone!"
        }
      }
    ],
    "has_more": true,
    "oldest_at": "2026-01-26T09:00:00Z",
    "newest_at": "2026-01-26T09:03:00Z"
  }
}
```

**Item types:** `message`, `question`, `poll`, `announcement`
