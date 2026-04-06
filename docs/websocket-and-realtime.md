# WebSocket & Real-time

## Overview

All real-time updates use a single WebSocket connection per client, multiplexed by event type. The hub manages room-scoped connections. Most mutations happen over HTTP and then broadcast via WebSocket; some client actions (chat, typing, Q&A submit/upvote) can also be initiated via WebSocket.

## Architecture

- **Hub:** `internal/delivery/websocket/hub.go`
- **Client:** `internal/delivery/websocket/client.go`
- **Event Handler:** `internal/delivery/websocket/event_handler.go`
- **WebSocket Handler:** `internal/delivery/websocket/handler.go`
- **Message Types:** `internal/delivery/websocket/message.go`

## Connection Setup

```
GET /ws
```

Token is read from the `token` HTTP-only cookie (browser clients). For non-browser clients (mobile, CLI) that cannot send cookies on WebSocket upgrade, the token may be passed as a query parameter:

```
GET /ws?token={jwt_token}
```

A warning is logged when the query-param fallback is used, since tokens in URLs may appear in proxy/access logs.

- Token must be a valid, room-scoped JWT containing `RoomID` and `ParticipantID` claims
- Obtain a room-scoped token via `POST /rooms/:room_code/join` or `POST /users/anonymous`
- On connect: client is registered with the hub into their room bucket
- On disconnect: client is unregistered; `room:user_left` is broadcast to the room

## Hub Architecture

```go
Hub {
    rooms    map[uint]map[*Client]bool  // roomID → set of clients
    register   chan *Client
    unregister chan *Client
    broadcast  chan BroadcastMessage
}
```

`hub.BroadcastToRoom(roomID, message)` — sends a message to all connected clients in a room. Thread-safe via channel routing. Clients with full send buffers are silently skipped (logged as warning).

## Client Read/Write Pumps

Each client has two goroutines:

- **ReadPump:** Reads incoming messages (max 512 KB), passes to `EventHandler.HandleMessage`
- **WritePump:** Sends outgoing messages from buffered channel; sends ping every 54 seconds; closes on pong timeout (60s)

## Message Format

All WebSocket messages are JSON:

```json
{
  "event": "event:name",
  "data": { ... }
}
```

## Complete Event Reference

### Room Events

| Event              | Direction       | Description                                                 |
| ------------------ | --------------- | ----------------------------------------------------------- |
| `room:join`        | Server → Client | Sent to the connecting client only on successful connection |
| `room:user_joined` | Server → Client | Broadcast when any participant connects                     |
| `room:user_left`   | Server → Client | Broadcast when any participant disconnects                  |
| `room:closed`      | Server → Client | Broadcast when presenter closes the room                    |
| `room:announce`    | Server → Client | Broadcast when presenter sends an announcement              |

### Chat Events

| Event          | Direction       | Description                                    |
| -------------- | --------------- | ---------------------------------------------- |
| `message:send` | Client → Server | Send a chat message via WebSocket              |
| `message:new`  | Server → Client | Broadcast a new chat message                   |
| `chat:typing`  | Bidirectional   | Typing indicator (`{ displayName, isTyping }`) |

### Q&A Events

| Event                    | Direction       | Description                                                                            |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------- |
| `question:submit`        | Client → Server | Submit a new question via WebSocket                                                    |
| `question:created`       | Server → Client | Broadcast when a question is submitted                                                 |
| `question:upvote`        | Client → Server | Upvote a question via WebSocket                                                        |
| `question:remove_upvote` | Client → Server | Remove upvote via WebSocket                                                            |
| `question:upvoted`       | Server → Client | Broadcast updated upvote count                                                         |
| `question:validated`     | Server → Client | Broadcast when a question is validated (via HTTP PATCH /api/v1/questions/:id/validate) |

### Poll Events

| Event                  | Direction       | Description                                      |
| ---------------------- | --------------- | ------------------------------------------------ |
| `poll:created`         | Server → Client | Broadcast when presenter creates a poll          |
| `poll:vote`            | Client → Server | Submit a poll vote via WebSocket (informational) |
| `poll:results_updated` | Server → Client | Broadcast updated vote counts after each vote    |
| `poll:closed`          | Server → Client | Broadcast when poll is closed                    |

### Leaderboard / XP Events

| Event                 | Direction       | Description                                           |
| --------------------- | --------------- | ----------------------------------------------------- |
| `leaderboard:updated` | Server → Client | Broadcast updated leaderboard after XP changes        |
| `leaderboard:request` | Client → Server | Request current leaderboard (sends only to requester) |
| `xp:awarded`          | Server → Client | Notification of XP awarded                            |

### Activity Events

| Event          | Direction       | Description                 |
| -------------- | --------------- | --------------------------- |
| `activity:new` | Server → Client | Broadcast new timeline item |

### WebRTC Events

| Event              | Direction       | Description                            |
| ------------------ | --------------- | -------------------------------------- |
| `webrtc:offer`     | Client → Server | SDP offer to establish peer connection |
| `webrtc:answer`    | Server → Client | SDP answer                             |
| `webrtc:candidate` | Bidirectional   | ICE candidate exchange                 |

### Conference Events

| Event                     | Direction       | Description                                        |
| ------------------------- | --------------- | -------------------------------------------------- |
| `conference:start`        | Client → Server | Start conference (host only)                       |
| `conference:started`      | Server → Client | Broadcast conference is active                     |
| `conference:stop`         | Client → Server | Stop conference (host only)                        |
| `conference:ended`        | Server → Client | Broadcast conference ended                         |
| `conference:state`        | Server → Client | Current conference state (sent to joining clients) |
| `conference:join`         | Client → Server | Join conference as audience                        |
| `conference:joined`       | Server → Client | Broadcast participant joined conference            |
| `conference:leave`        | Client → Server | Leave conference                                   |
| `conference:left`         | Server → Client | Broadcast participant left conference              |
| `conference:raise_hand`   | Client → Server | Raise hand to request speaking                     |
| `conference:hand_raised`  | Server → Client | Broadcast raised hand                              |
| `conference:lower_hand`   | Client → Server | Lower raised hand                                  |
| `conference:hand_lowered` | Server → Client | Broadcast lowered hand                             |
| `conference:promote`      | Client → Server | Promote participant to speaker (host only)         |
| `conference:promoted`     | Server → Client | Broadcast participant promoted                     |
| `conference:demote`       | Client → Server | Demote speaker (host only)                         |
| `conference:demoted`      | Server → Client | Broadcast speaker demoted                          |

## EventHandler Routing

`EventHandler.HandleMessage()` dispatches by `event` field:

| Incoming Event           | Handler Method               | Action                                                                   |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------ |
| `message:send`           | `handleMessageSend`          | Calls MessageUseCase.Send, broadcasts `message:new`, updates leaderboard |
| `chat:typing`            | `handleChatTyping`           | Broadcasts typing status to room (excluding sender)                      |
| `leaderboard:request`    | `handleLeaderboardRequest`   | Sends leaderboard to requesting client only                              |
| `question:submit`        | `handleQuestionSubmit`       | Calls QuestionUseCase.Submit, broadcasts `question:created`              |
| `question:upvote`        | `handleQuestionUpvote`       | Calls QuestionUseCase.Upvote, broadcasts `question:upvoted`              |
| `question:remove_upvote` | `handleQuestionRemoveUpvote` | Calls QuestionUseCase.RemoveUpvote, broadcasts `question:upvoted`        |
| `webrtc:offer`           | `handleWebrtcOffer`          | Creates/renegotiates peer via SFU                                        |
| `webrtc:answer`          | `handleWebrtcAnswer`         | Processes SDP answer                                                     |
| `webrtc:candidate`       | `handleWebrtcCandidate`      | Processes ICE candidate                                                  |
| `conference:start`       | `handleConferenceStart`      | Starts conference (room owner only)                                      |
| `conference:stop`        | `handleConferenceStop`       | Stops conference (room owner only)                                       |
| `conference:join`        | `handleConferenceJoin`       | Sends current state to joining client                                    |
| `conference:leave`       | `handleConferenceLeave`      | Broadcasts user left                                                     |
| `conference:raise_hand`  | `handleRaiseHand`            | Adds to raised hands list, broadcasts                                    |
| `conference:lower_hand`  | `handleLowerHand`            | Removes from raised hands, broadcasts                                    |
| `conference:promote`     | `handlePromoteSpeaker`       | Adds to speakers (host only)                                             |
| `conference:demote`      | `handleDemoteSpeaker`        | Removes from speakers (host only)                                        |

## Broadcasting Pattern in Controllers

Controllers that need to broadcast receive the hub as a dependency:

```go
// After a Q&A action:
hub.BroadcastToRoom(roomID, websocket.Message{
    Event: websocket.EventQuestionCreated,
    Data:  questionResponse,
})

// After any XP-awarding action:
broadcastLeaderboardUpdate(hub, roomID)
```

`broadcastLeaderboardUpdate` is a helper that fetches the updated leaderboard and broadcasts `leaderboard:updated` to the room.
