# Multiplayer co-op rooms — design (ROADMAP Batch 7.1)

> Status: **design, 2026-09-15** — reviewed against the codebase as it stands after PR #69.
> Nothing here is built. ROADMAP 7.2 holds the ordered work orders; this document is the
> "why" and the contract they implement against. Decisions marked **D1–D4** need the
> project owner's call before 7.2 starts; everything else is decided here.

## 1. What it is (product rules)

- A **room** is 2–8 players on **the same board**: identical target word, identical letter
  multiset, one **shared server deadline**. Rooms are joined by a 6-character code (or a
  `?room=CODE` link) — no login, the existing anonymous cookie identity is enough.
- Each player finds words **privately**. Others see, live: display name, how many words
  each player has found, and their score — **never which words** until the game ends.
- **A word found by two players counts for both.** Pure co-op/race feel, no claim-ordering,
  no "first finder only" (that is a possible later room option, not v1).
- The room **collectively clears the board** when the *union* of everyone's found words
  covers every findable word. Everyone still playing then gets an equal share of the
  time-remaining completion bonus (D2).
- Personal mechanics are unchanged and personal: hints cost *you* points and reveal to
  *you* only; rescramble only reorders *your* view; give-up ends *your* game (others
  continue). A player who personally clears the whole board keeps the normal personal
  completion bonus.
- Game end (any of): the shared deadline passes · the room collectively clears · every
  member has reached a terminal state (given up / personally cleared). Then the full reveal:
  per-player word lists, remaining words, target word, and a "rematch" pointer.
- Room games do **not** appear on the single-player leaderboards (D3): a co-op board with
  shared finds is not comparable. They do count toward the player's own aggregate stats
  and `word_stats` (the target word was still their target).
- A **display name is required** to create or join a room (the first player-facing use of
  `players.display_name`, ROADMAP 2.1's deferred "name yourself" input).

## 2. Why this shape: rooms are ad-hoc daily puzzles

The daily puzzle (Batch 10 item 1, `lib/daily.ts`, `migrations/0018`) already solved the
core problem — *one shared board, many players, every existing mechanic untouched*: a
`daily_puzzles` row holds the board, and each player plays an **ordinary `games` row**
that points at it. `guess` / `hint` / `give_up` / lazy expiry / `word_stats` /
achievements never learned anything about "daily".

A room is exactly that with three additions: an explicit member list, a shared `ends_at`
stamped at start (instead of "the calendar day"), and a collective-clear check. So:

- `rooms` plays the role of `daily_puzzles` (board + deadline + status),
- `games.room_id` plays the role of `games.daily_puzzle_id`,
- one new hook in `guess()` / `giveUp()` (collective clear / everyone-done) plays the
  role of the daily grade in `finalizeWordStats`.

Everything else — scoring, hint cost floor, the found_count atomic UPDATE, the rate limit,
the reveal endpoint — is reused verbatim, by construction rather than by porting.

## 3. Data model (`migrations/0020_rooms.sql`, purely additive)

```sql
create table rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,        -- 6 chars from ABCDEFGHJKMNPQRSTUVWXYZ23456789
  host_player_id    uuid references players(id) on delete set null,
  wordlist_id       bigint not null references wordlists(id),
  target_length     int  not null check (target_length between 5 and 10),
  status            text not null default 'lobby'
                      check (status in ('lobby','playing','finished','cancelled')),
  -- board, null until start (same columns as daily_puzzles):
  target_word       text,
  scrambled_letters text,
  possible_count    int,
  started_at        timestamptz,
  ends_at           timestamptz,
  ended_at          timestamptz,
  next_room_code    text,                        -- rematch pointer, set by the host
  created_at        timestamptz not null default now()
);
create index rooms_status_created_idx on rooms (status, created_at);

create table room_players (
  room_id      uuid not null references rooms(id)   on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  game_id      uuid references games(id) on delete set null,  -- this member's game, once started
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),             -- lobby presence (see §5)
  primary key (room_id, player_id)
);

alter table games add column room_id uuid references rooms(id) on delete set null;
create index games_room_idx on games (room_id) where room_id is not null;
```

Deliberate choices:
- **No `score` / `found_count` columns on `room_players`** (the ROADMAP sketch had them).
  Both are already derivable from the member's `games` row + `game_guesses` exactly the way
  `loadGame` derives them — a second copy would be a second thing to keep consistent under
  the concurrent-guess races this repo has already fought once (`found_count`, PR-2.2 era).
- **No new `games.status` value.** A room-ended member game becomes `finished` (collective
  clear) or `expired` (deadline) — the existing states. `room_id is not null` is the
  discriminator wherever a room game must be treated differently (leaderboards, the
  `full_clear*` achievements). Same reasoning as `disqualified_at` in `migrations/0006`:
  don't touch the status check constraint.
- `host_player_id on delete set null`: an account deletion (`DELETE /api/v1/me`) mid-lobby
  leaves a host-less room, which reads as `cancelled` (§4). `room_players` cascades, games
  are anonymised as today.
- `possible_count` is frozen on the room at start (like `games.possible_count`), so the
  collective-clear comparison is stable even if a findable word is deactivated mid-game
  (ROADMAP 4.1's accepted edge case, unchanged).

## 4. API (all under `/api/v1/rooms`, one `matchRoute` block in the dispatcher)

Identity: `resolveOrMintIdentity` (the same helper `game/start` and `daily/start` use), so
a first-ever visitor can create or join a room in one request. Every route below returns
`Reply` objects from a new `lib/rooms.ts`, keeping the dispatcher thin.

| Method & path | Who | Effect |
|---|---|---|
| `POST /rooms` `{display_name, wordlist?, target_length?}` | anyone | Create a `lobby` room, set the caller's `display_name`, join as host. Applies the item-14 hidden-selector forcing (`resolveDailyAxes`-style). → `{code, room}` |
| `POST /rooms/{code}/join` `{display_name}` | anyone | Join a `lobby` room. Idempotent for an existing member. 404 unknown · 409 `room_started` / `room_full` (8) / `room_cancelled`. → `{room}` |
| `POST /rooms/{code}/leave` | member | Lobby only. A leaving **host cancels the room** (v1: no host hand-off). |
| `POST /rooms/{code}/start` | host | Lobby → `playing`. Picks the target (uniform random, **not** `pickPersonalizedWord` — it's one board for everyone, same rule as the daily), computes `possible`, stamps `ends_at = now() + durationForLength(...)`, and **inserts one `games` row per member in one statement**, all with `room_id` and the shared `ends_at`. 409 `not_enough_players` below 2. |
| `GET /rooms/{code}` | member | **The snapshot** — the single read used for polling, reconnection and the end-of-game reveal (§5). Touches the caller's `last_seen_at`. |
| `POST /rooms/{code}/rematch` | host, `finished` room | Creates a new lobby room with the same settings, sets `next_room_code` on the old one, joins the host. Others see the pointer in their next snapshot and join with one tap. |

Snapshot body (shape is the contract 7.2's frontend builds against):

```jsonc
{
  "code": "K7PX2Q", "status": "playing",           // lobby | playing | finished | cancelled
  "wordlist": "hu", "target_length": 7,
  "is_host": true, "member_count": 3, "max_members": 8,
  "ends_at": 1789000000.0, "possible_count": 41,   // null in lobby
  "members": [
    { "player_id": "…", "display_name": "Anna", "is_you": false, "is_host": true,
      "online": true,                               // last_seen_at within 10 s (lobby only)
      "found_count": 5, "score": 61, "done": false } // done = own game terminal
  ],
  "your_game": {                                    // playing/finished only, for the caller
    "game_id": "…", "scrambled_letters": "A K L M Á Z T", "alphabet": "…",
    "ends_at": 1789000000.0, "duration_seconds": 150
  },
  "reveal": {                                       // finished only
    "target_word": "…", "remaining_words": ["…"],
    "members": [{ "player_id": "…", "display_name": "Anna", "words": ["…"], "final_score": 71 }],
    "room_cleared": true, "bonus_per_member": 12
  },
  "next_room_code": null
}
```

The member's own game is played through the **existing** `game/{id}/guess|hint|give_up|
rescramble|possible_words` routes with `your_game.game_id` — no room-specific guess route.

### Lifecycle hooks (the only new logic inside existing code paths)

- `guess()` — after the found_count UPDATE, if `game.room_id`: run `checkRoomClear(sql,
  room_id)`: `select count(distinct gg.word) … where g.room_id = $1 and gg.correct` ≥
  `rooms.possible_count` ⇒ `finishRoom(sql, room, reason='cleared')`.
- `giveUp()` — if `game.room_id`: `checkAllDone` (every member game terminal) ⇒
  `finishRoom(…, 'all_done')`.
- `GET /rooms/{code}` — if `status = 'playing'` and `now() > ends_at`: for each member game
  call the existing `finalizeExpiry` (already idempotent via its `status = 'active'`
  guard), then `finishRoom(…, 'expired')`. Lazy, exactly like single-player expiry.
- `finishRoom` is race-safe the same way `finalizeExpiry` is: `update rooms set status =
  'finished', ended_at = now() where id = $1 and status = 'playing'`; only the invocation
  whose UPDATE count is 1 ends the member games and pays the bonus. For `cleared`: every
  member game still `active` gets `status = 'finished', ended_at = now(), final_score =
  effectiveScore + bonus_share` (D2), then `finalizeWordStats` per game (so `word_stats`,
  daily-style bookkeeping and achievements fire once, as today).

### Existing code that must learn `room_id is null`

- `lib/scores.ts` both queries (top + your_best): `and g.room_id is null` (D3).
- `lib/achievements.ts`: skip `full_clear` / `full_clear_no_hints` when `game.room_id` is
  set (a collective clear marks every member `finished`; the badge means a *personal* clear).
- `lib/admin-dashboard.ts` / `admin-players.ts`: nothing required; a room-count tile and a
  `room_id` column in the game drill-down are a small follow-up (7.2.7).

## 5. Realtime transport — **D1, needs a decision**

ROADMAP architectural decision 7 locks **Ably** for this. Reviewing it against the actual
shape of the feature and the free tiers as of 2026-09:

| | Polling the snapshot | Ably push |
|---|---|---|
| What players see | Opponent counters update within ~3 s | Sub-second |
| New vendor / credentials | none | Ably account + server API key on Vercel (owner-only step, "confirm first") |
| New client code | one `useRoom` hook: `setInterval` + `document.hidden` pause | ably-js (+~90 kB), token-auth endpoint, connection lifecycle, reconnection **plus** the same snapshot endpoint anyway (resync) |
| Server code | none beyond the snapshot route | publish from the guess / start / finish hooks via Ably's REST endpoint |
| Cost at hobby scale | 4 players × 150 s / 3 s ≈ 200 invocations + a lobby ≈ 250 per game. Vercel Hobby: 1 M invocations & 4 active-CPU-hours / month → **>1 500 rooms/month** before either meter matters; single-player traffic today is far below that | 6 M msgs / 200 connections / month — effectively unlimited here |
| Failure mode | a slow poll = a stale counter | a dropped connection = a stale counter *until* the snapshot resync — i.e. you still need polling-shaped code |

**Recommendation: build 7.2 polling-first, and treat Ably as an optional latency upgrade
(7.2.8) behind the identical snapshot contract.** The snapshot route is mandatory in both
designs (reconnection), the data model is identical in both, and the only thing Ably adds
for a "how many words has Anna found" counter is a second or two of latency and a vendor.
If Ably is added later, the cleanest integration is *event-as-poke*: the client receives a
message and refetches the snapshot, so ordering/duplication never matters and polling stays
as the 15-second fallback. This deviates from decision 7 as written, so it is the owner's
call, not a default.

Polling details either way: 3 s in lobby and in game; pause while `document.hidden`; stop
on `finished`/`cancelled`; the snapshot is cheap (3 indexed reads) and its `last_seen_at`
touch doubles as lobby presence (`online` = seen within 10 s).

Sources checked 2026-09-15: [Vercel Hobby limits](https://costbench.com/software/developer-tools/vercel/free-plan/),
[Ably limits](https://ably.com/docs/platform/pricing/limits),
[Neon free plan](https://neon.com/faqs/free-plan-limits-and-quotas) (100 CU-hours/month — the DB is
only awake while people play, polling does not change that).

## 6. Frontend

- **Entry point:** a `RoomPanel` inside `<SettingsPanel>` (the `DailyPanel` pattern):
  display-name field (prefilled from the new `display_name` preference), "Create room"
  (uses the current length/wordlist selectors) and "Join by code". A `?room=CODE` deep link
  opens the panel pre-filled and prompts to join.
- **Lobby** replaces the pre-game board area: big copyable code + share link, member list
  with online dots, host's *Start* (disabled below 2), *Leave*.
- **In game:** the normal board/input/timer/actions, plus a compact **opponent strip**
  (name · found/possible · score) fed by the snapshot, and a `👥 CODE` board badge next to
  the existing 🗓️/🌱 ones. Guess/hint/give-up call the existing API with `your_game.game_id`.
- **End:** a comparison view (per-member revealed words, remaining words, the target) and
  *Rematch* (host) / *Join the rematch* (others, when `next_room_code` appears).
- **Timer:** `Timer` already renders from a server `ends_at`; the room's shared deadline
  drops straight in.

### Why `useGame` extraction is the first 7.2 work order (7.2.1)

`App.jsx` starts a game by calling `startGame`/`startDailyGame` inside `startNewGame` and
then applying ~20 setters to the response. In a room, the start payload arrives *from a
snapshot poll* (the host started; you didn't call anything). Threading that through today's
code means a fourth `startNewGame` flag and a second copy of the setter block — the exact
growth ROADMAP's "Frontend refactor" bullet warned about. A `useGame()` hook exposing
`beginFromStartResponse(payload)` (the setter block) and `endGame(reason)` (the shared
terminal transition the timer/give-up/full-clear paths already all perform) is the seam
room mode needs; both single-player and daily then call the same two functions. This is
the extraction 7.2 was designated to carry all along — done first, as its own PR, with the
E2E coverage extended *before* room code lands on top of it.

## 7. Decisions for the owner

- **D1 — Transport:** polling-first with optional Ably later (recommended), or Ably from
  the start per decision 7.
- **D2 — Bonus on a collective clear:** equal split among members still playing
  (`floor(remaining_seconds × multiplier / member_count)`) — recommended — vs. the full
  bonus to everyone, vs. none. A *personal* full clear keeps today's full personal bonus.
- **D3 — Leaderboards:** room games excluded from the single-player boards (recommended);
  room results live only in the room's reveal. Alternative: a separate "rooms" board later.
- **D4 — Host leaves / disappears:** v1 cancels the room (recommended, simplest); the
  alternative (host hand-off to the next member) is a follow-up if it hurts in practice.

Decided here without asking (reversible, within the existing conventions): 6-char codes from
an unambiguous alphabet · room cap 8 · min 2 to start · no late join after start · rooms
are single-round, rematch = new room with a pointer · lobby rooms idle >30 min are reported
as `cancelled` by the snapshot (no sweeper process; lazy, like game expiry) · the target is
a uniform random pick, never personalised.
