# Google Play release kit (ROADMAP Batch 16)

Working notes for publishing Betűvető on Google Play as a Trusted Web Activity (TWA): the
existing PWA in a Chrome-backed Android shell. Drafted 2026-10-29 from the code and
database schema; every answer here must be re-checked against the live Play Console forms,
which change over time. Owner-only steps are marked **(owner)**.

## Fixed choices

| Item | Value | Note |
|---|---|---|
| Application ID | `com.tmsso.betuveto` | Irreversible once published. |
| Start URL / scope | `https://betuveto.tmsso.com/` | Manifest `id`, `start_url` and `scope` are `/`. |
| Package build | PWABuilder (pwabuilder.com → Android) in the owner's browser | No local Android SDK on this machine. |
| Signing | Play App Signing; PWABuilder's upload key goes into the password manager on day one | Losing the upload key means a support ticket to reset it. |
| Contact channel in the app | In-app feedback form | No email in the repo or the bundle. |

## Steps

1. **(owner)** Create the Play developer account (personal, USD 25, identity verification).
   Play requires a **public developer email** shown on the store listing (Play Console Help
   10840893 and 13634081). Use a dedicated address, not a personal inbox. It lives only in
   Play Console, never in this repo.
2. **(owner)** In Play Console create the app: name "Betűvető", default language Hungarian,
   game, free.
3. **(owner)** PWABuilder: enter `https://betuveto.tmsso.com`, choose Android, set the package
   ID `com.tmsso.betuveto`, and download the zip (signed `.aab` + signing key + `assetlinks.json`).
   Store the key file and its passwords in the password manager.
4. **(owner)** Upload the `.aab` to the **closed testing** track. Play Console then shows the
   **App signing key certificate SHA-256** (Setup → App signing).
5. Put that SHA-256 into `frontend/public/.well-known/assetlinks.json` (currently `[]`) in a PR:

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.tmsso.betuveto",
       "sha256_cert_fingerprints": ["<App signing key SHA-256 from Play Console>"]
     }
   }]
   ```

   Done when `https://betuveto.tmsso.com/.well-known/assetlinks.json` serves it and the
   installed test app opens with no browser address bar.
6. **(owner)** Fill in the forms below, add at least 12 testers, and keep them opted in for 14
   consecutive days. Then apply for production access.

## Data safety form (draft)

Derived from the schema (`migrations/`) and the privacy page. "Shared" means passed to a
third party other than a service provider. Vercel, Neon and Sentry act as processors for
the project, so nothing is shared.

| Play data type | Collected? | What it is in Betűvető | Optional? | Purposes |
|---|---|---|---|---|
| Location → Approximate location | Yes | Country derived from the IP when a game starts (`games.country`), admin-only | No | Analytics |
| Personal info → Name | Yes | Display name (a nickname the player chooses), shown on leaderboards and in rooms; with Google sign-in also the Google account name, kept by Neon Auth and never shown | Yes | App functionality, Account management |
| Personal info → Email address | Yes | Only with the optional Google sign-in (Batch 8.1): Neon Auth stores the Google email in its `neon_auth` tables in our database; shown only to the player, in Settings | Yes | Account management |
| Personal info → User IDs | Yes | Only with Google sign-in: the Neon Auth user id (`players.auth_user_id`) and the Google account id Neon Auth keeps | Yes | Account management |
| App activity → App interactions | Yes | Games, guesses, scores, streaks, achievements, per-word solve counts, room membership | No | App functionality, Analytics |
| App activity → Other user-generated content | Yes | Feedback messages, word reports, word suggestions, name reports | Yes | App functionality (support, moderation) |
| App info and performance → Crash logs | Yes | Sentry error reports (frontend and API) | No | App functionality (diagnostics) |
| App info and performance → Diagnostics | Yes | Browser user-agent stored with feedback; Sentry context | No | App functionality |
| Device or other IDs | Yes | Random player ID in the `bv_anon` cookie; keyed hash of the IP for 24 h when a new ID is minted | No | App functionality, Fraud prevention/security |
| Everything else (phone, contacts, photos, payments, health, …) | No | | | |

- Data encrypted in transit: **yes** (HTTPS only).
- Users can request deletion: **yes**. In-app: Settings → Privacy → "Delete my data"
  (`DELETE /api/v1/me`). Deletion URL for the form: `https://betuveto.tmsso.com/privacy`.
- Accounts: playing needs no account, but the optional Google sign-in creates one, so Play's
  account-deletion requirement applies. The same "Delete my data" button covers it: it
  deletes the player **and** the Neon Auth user (`neon_auth."user"`, whose sessions and
  linked Google account rows cascade), so the email and name are gone too. Admin accounts are
  refused there (removed by hand). Verified by `tests/delete-me.test.ts`.
- Google profile picture: Neon Auth stores only the picture's URL, which the game never
  shows. Not declared as "Photos" (no image is collected); re-check this against the live form.

**Log drain (checked 2026-10-29):** no Vercel log drains exist (neither current nor legacy
integration drains). `SENTRY_VERCEL_LOG_DRAIN_URL` is only a URL the Sentry integration
provides, so no request logs or IPs are forwarded. To make sure Sentry never keeps a reporter's
IP either, turn on **Security & Privacy → Prevent Storing of IP Addresses** in the Sentry
project settings **(owner)**.

## Content rating (IARC) questionnaire (draft)

Category: Game (word/puzzle). Expected answers: no violence, no sexual content, no
profanity *by design* (but see below), no drugs/alcohol/tobacco, no gambling or simulated
gambling, no purchases.

- **User interaction:** yes. Players can choose a display name that other players see
  (leaderboards, rooms). There is no chat or free-text messaging between players.
- **Shares location with other users:** no (country is admin-only).
- **Unmoderated user content:** display names are filtered by a blocklist (`lib/name-filter.ts`)
  and can be reported (ROADMAP 16.2). The admin can rename.
- The word lists are full dictionaries and may contain crude words as valid answers. Answer
  the "crude humour / profanity" question honestly. In practice they are valid board words,
  never shown unprompted (only in found-word lists and the post-game solution list).

Expected result: PEGI 3 / Everyone, possibly PEGI 7 for the user-interaction element.

## Store listing (draft)

- **App name:** Betűvető
- **Short description (hu, ≤80):** Rakj ki minél több szót a megkevert betűkből!
- **Short description (en, ≤80):** Make as many words as you can from scrambled letters.

**Full description (hu, ≤4000):**

> Rakj ki minél több szót a megkevert betűkből, mielőtt lejár az idő!
>
> A Betűvető gyors, ingyenes magyar szójáték. Kapsz néhány betűt, és kirakod belőlük az összes szót, ami eszedbe jut. Minél hosszabb a szó, annál több pont jár érte, és ha a táblán rejlő összes szót megtalálod, bónuszt kapsz.
>
> • **Napi rejtvény:** ma mindenki ugyanazt a táblát kapja. Naponta egy eredmény számít, és sorozatot gyűjthetsz.
> • **Játék barátokkal:** hozz létre egy szobát, küldd el a meghívó linket, és játsszatok együtt (legfeljebb 8-an) vagy egymás ellen.
> • **Ranglisták és statisztikák:** nézd meg, hol tartasz, és gyűjts kitüntetéseket.
> • **Te döntöd el a nehézséget:** 5–10 betűs táblák, és ha elakadsz, segítséget is kérhetsz (pontlevonással).
> • **Magyarul és angolul:** a játék magyar és angol szótárral is játszható.
> • **Világos és sötét téma.**
>
> Nincs regisztráció és nincs reklám. Ha egy szót hibásnak tartasz, vagy hiányzik egy, egy kattintással jelezheted; a szótár így folyamatosan javul.

**Full description (en, ≤4000):**

> Make as many words as you can from scrambled letters before the clock runs out!
>
> Betűvető is a quick, free word game, playable in Hungarian and English. You get a handful of letters; spell every word you can find. Longer words score more, and finding every word on the board earns a bonus.
>
> • **Daily puzzle:** everyone gets the same board each day. One result counts per day, and you can build a streak.
> • **Play with friends:** create a room, share the invite link, and play together (up to 8 players) or against each other.
> • **Leaderboards and stats:** see how you are doing and collect achievements.
> • **Your difficulty:** boards of 5 to 10 letters, and a hint when you are stuck (it costs points).
> • **Hungarian and English:** play with either dictionary.
> • **Light and dark themes.**
>
> No sign-up and no ads. If a word looks wrong or one is missing, report it with one tap; that is how the dictionary keeps improving.

Every claim above is checked against the app as of 2026-11-03 (room size `MAX_MEMBERS` = 8 in
`lib/rooms.ts`; lengths 5–10; daily streaks; achievements). Re-check before each listing update.

- **Screenshots (generated 2026-11-03, regenerated 2026-11-09 with the design refresh + new title):** `docs/play-store/screenshots/{hu,en}/01–05*.jpg`,
  1080×1920 JPEG (Play's portrait size for games; JPEG because Play rejects PNGs with alpha).
  Start screen, a game in progress, the daily puzzle, a room lobby, a room mid-game. Upload the
  hu set to the Hungarian (default) listing and the en set to the English translation.
  Regenerate with `frontend/play-assets/screenshots.spec.ts` against a PR preview (never
  production; it writes players, games and a room): instructions in the file header. Only the
  made-up names Anna and Bence appear; no leaderboard is shot, because a preview database is a
  copy of production and would show real players' names.
- **Feature graphic (generated):** `docs/play-store/feature-graphic-{hu,en}.jpg`, 1024×500, from
  `docs/play-store/feature-graphic.html` (edit the HTML and re-render with
  `npx playwright test -c playwright.assets.config.ts feature-graphic` in `frontend/`).
- **App icon:** `frontend/public/pwa-512x512.png` (512×512 PNG, Play's required size).
- **Privacy policy URL:** `https://betuveto.tmsso.com/privacy`.
- **Terms:** `https://betuveto.tmsso.com/terms` (wording signed off by the owner 2026-10-29).
- **Category:** Word (Games). Tags: word, puzzle, Hungarian.
- **Ads:** none. **In-app purchases:** none. **Target audience:** 13+ is the simplest choice.
  An audience including under-13s pulls in Families policy requirements.
