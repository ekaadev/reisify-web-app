# Conference & WebRTC

## Overview

An optional video conferencing layer on top of the interactive QnA platform, implemented as a Pion-based Selective Forwarding Unit (SFU). The conference feature is entirely WebSocket-driven with no HTTP endpoints. It is independent of the main HTTP/domain flow and is controlled by the room owner.

## Architecture

- **SFU Package:** `internal/sfu/` — Pion WebRTC SFU implementation
- **Event Handler:** Conference methods in `internal/delivery/websocket/event_handler.go`
- **Client:** `internal/delivery/websocket/client.go` — stores `isRoomOwner` flag

The SFU is wired into the `EventHandler` but operates independently of the room/participant use cases.

## Lifecycle

```
host sends conference:start
         |
         v
Server broadcasts conference:started to room
         |
         v
Audience sends conference:join
         |
         v
Server sends conference:state to joining client
         |
         v
Participants exchange WebRTC signals (offer/answer/candidate)
         |
         v
(Optional) Host promotes audience member to speaker
         |
         v
host sends conference:stop
         |
         v
Server broadcasts conference:ended to room
```

## WebSocket Events

### Conference Control (Host Only)

| Event                | Direction       | Auth            | Description                                 |
| -------------------- | --------------- | --------------- | ------------------------------------------- |
| `conference:start`   | Client → Server | Room owner only | Start the conference session                |
| `conference:started` | Server → Client | Broadcast       | Conference is now active                    |
| `conference:stop`    | Client → Server | Room owner only | Stop the conference session                 |
| `conference:ended`   | Server → Client | Broadcast       | Conference has ended                        |
| `conference:state`   | Server → Client | Individual      | Current state sent to newly joining clients |

### Audience Participation

| Event               | Direction       | Description                         |
| ------------------- | --------------- | ----------------------------------- |
| `conference:join`   | Client → Server | Join as audience viewer             |
| `conference:joined` | Server → Client | Broadcast that a participant joined |
| `conference:leave`  | Client → Server | Leave the conference                |
| `conference:left`   | Server → Client | Broadcast that a participant left   |

### Hand Raise System

| Event                     | Direction       | Description                   |
| ------------------------- | --------------- | ----------------------------- |
| `conference:raise_hand`   | Client → Server | Request to speak              |
| `conference:hand_raised`  | Server → Client | Broadcast someone raised hand |
| `conference:lower_hand`   | Client → Server | Cancel request to speak       |
| `conference:hand_lowered` | Server → Client | Broadcast hand was lowered    |

### Speaker Management (Host Only)

| Event                 | Direction       | Description                        |
| --------------------- | --------------- | ---------------------------------- |
| `conference:promote`  | Client → Server | Promote audience member to speaker |
| `conference:promoted` | Server → Client | Broadcast someone was promoted     |
| `conference:demote`   | Client → Server | Demote speaker back to audience    |
| `conference:demoted`  | Server → Client | Broadcast someone was demoted      |

### WebRTC Signaling

| Event              | Direction       | Description                                                      |
| ------------------ | --------------- | ---------------------------------------------------------------- |
| `webrtc:offer`     | Client → Server | SDP offer — creates or renegotiates a peer connection in the SFU |
| `webrtc:answer`    | Server → Client | SDP answer from SFU                                              |
| `webrtc:candidate` | Bidirectional   | ICE candidate exchange                                           |

## Authorization

Conference control actions are enforced at the `EventHandler` level via `client.isRoomOwner`:

- `conference:start`, `conference:stop` — restricted to room owner
- `conference:promote`, `conference:demote` — restricted to room owner
- All other conference events — any participant in the room

`isRoomOwner` is set when the WebSocket client connects, derived from the JWT claim.

## SFU Details

- **Library:** Pion WebRTC (`github.com/pion/webrtc`)
- **Location:** `internal/sfu/`
- The SFU acts as a media relay: publishers send tracks to the SFU, and the SFU forwards them to all subscribers
- Peer connections are managed by the SFU package and referenced by participant/client identity
- Renegotiation is triggered when new participants join or leave

## Business Rules

- Conference is independent of room status — a conference can theoretically run even after room close (no explicit validation)
- A participant can only be in one role at a time (audience or speaker)
- The raised hand queue is managed in-memory on the hub/event handler; it is not persisted to the database
- Promoting a speaker triggers a WebRTC renegotiation so the promoted participant can start sending media
- Conference events do not award XP
- Conference state is in-memory only; it is lost if the server restarts
