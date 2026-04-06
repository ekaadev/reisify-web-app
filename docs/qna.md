# Q&A (Questions)

## Overview

The core feature for quality interaction. Designed as a structured forum for audience members to submit questions, insights, or ideas. Contributions here are the primary basis for the XP gamification system. Questions go through a moderation/validation workflow by the presenter.

## Architecture

- **Controller:** `internal/delivery/http/question_controller.go`
- **Use Case:** `internal/usecase/question_usecase.go`
- **Repository:** `internal/repository/question_repository.go`, `internal/repository/vote_repository.go`
- **Entity:** `internal/entity/question_entity.go`, `internal/entity/vote_entity.go`
- **Model/DTO:** `internal/model/question_model.go`
- **Converter:** `internal/model/converter/question_converter.go`

## Data Model

### Question Entity (`questions` table)

| Field                  | Type      | Notes                                         |
| ---------------------- | --------- | --------------------------------------------- |
| ID                     | uint      | Primary key                                   |
| RoomID                 | uint      | FK → rooms.id, indexed                        |
| ParticipantID          | uint      | FK → participants.id, indexed                 |
| Content                | text      | Question text                                 |
| UpvoteCount            | uint      | Denormalized, managed by DB trigger           |
| Status                 | enum      | `pending`, `answered`, `highlighted`, indexed |
| IsValidatedByPresenter | bool      | Default false, indexed                        |
| XPAwarded              | uint      | Total XP given for this question              |
| CreatedAt              | time.Time | Indexed                                       |

### Vote Entity (`votes` table)

| Field         | Type      | Notes                                                                 |
| ------------- | --------- | --------------------------------------------------------------------- |
| ID            | uint      | Primary key                                                           |
| QuestionID    | uint      | FK → questions.id, indexed                                            |
| ParticipantID | uint      | FK → participants.id, indexed                                         |
| CreatedAt     | time.Time | Indexed                                                               |
| Unique        | —         | (QuestionID, ParticipantID) — one upvote per participant per question |

## API Endpoints

### POST /api/v1/rooms/:room_id/questions

- **Auth:** Required
- **Request:** `{ content: string }`
- **Response:** `{ question: QuestionResponse, xpEarned: { points, newTotal } }`
- **Logic:** Create question; award 10 XP to author; broadcast `question:created`

### GET /api/v1/rooms/:room_id/questions

- **Auth:** Required
- **Query Params:** `status` (optional filter), `sort_by` (upvotes|recent|validated), `limit`, `offset`
- **Response:** `{ questions: QuestionResponse[], paging: { total, limit, offset } }`
- **Logic:**
  - Default sort: `upvote_count DESC, created_at DESC`
  - `recent`: `created_at DESC`
  - `validated`: `is_validated_by_presenter DESC, upvote_count DESC, created_at DESC`
  - Includes `hasVoted: bool` per question for the current participant (batch lookup via `VoteRepository.GetVotedQuestionIDs`)

### POST /api/v1/questions/:question_id/upvote

- **Auth:** Required
- **Response:** `{ vote: VoteResponse, question: { id, upvoteCount }, xpEarned: { recipientParticipantID, points, source } }`
- **Logic:**
  - Prevent self-vote (same participantID as question author)
  - Prevent duplicate vote (unique constraint enforced at DB + application level)
  - Create Vote record; DB trigger increments `questions.upvote_count`
  - Award 3 XP to question author (not voter)

### DELETE /api/v1/questions/:question_id/upvote

- **Auth:** Required
- **Response:** `{ question: { id, upvoteCount } }`
- **Logic:** Delete Vote record; DB trigger decrements `questions.upvote_count`; deduct 3 XP from question author

### PATCH /api/v1/questions/:question_id/validate

- **Auth:** Required (presenter only)
- **Request:** `{ status: "answered" | "highlighted" }`
- **Response:** `{ question: { id, status, isValidatedByPresenter }, xpAwarded: { participantID, points, newTotal } }`
- **Logic:**
  - Verify caller is room presenter
  - Set `is_validated_by_presenter = true`, update `status`
  - Award 25 XP to question author
  - Prevent re-validation (already validated questions cannot be re-validated)
  - Broadcast `question:validated`

## WebSocket Events

| Event                    | Direction       | Payload                                  |
| ------------------------ | --------------- | ---------------------------------------- |
| `question:submit`        | Client → Server | `{ content: string }`                    |
| `question:created`       | Server → Client | `QuestionResponse`                       |
| `question:upvote`        | Client → Server | `{ questionID: uint }`                   |
| `question:remove_upvote` | Client → Server | `{ questionID: uint }`                   |
| `question:upvoted`       | Server → Client | `{ id, upvoteCount }`                    |
| `question:validated`     | Server → Client | `{ id, status, isValidatedByPresenter }` |

## XP Logic

| Action              | XP    | Recipient       | Source Type                  |
| ------------------- | ----- | --------------- | ---------------------------- |
| Submit question     | 10 XP | Question author | `question_created`           |
| Receive upvote      | +3 XP | Question author | `upvote_received`            |
| Upvote removed      | -3 XP | Question author | `upvote_received` (negative) |
| Presenter validates | 25 XP | Question author | `presenter_validated`        |

## Business Rules

- A participant cannot upvote their own question
- A participant can only upvote a question once (DB unique constraint + app-level check)
- Upvote removal reverses the XP grant (negative XP transaction)
- Only the room presenter can validate questions
- A question can only be validated once (`IsValidatedByPresenter` is a one-way flag)
- `upvote_count` is managed by DB triggers; the app does NOT manually update this field
- Questions are scoped to a room; cross-room queries are not possible
