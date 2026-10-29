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
| Personal info → Name | Yes | Display name (a nickname the player chooses), shown on leaderboards and in rooms | Yes | App functionality |
| App activity → App interactions | Yes | Games, guesses, scores, streaks, achievements, per-word solve counts, room membership | No | App functionality, Analytics |
| App activity → Other user-generated content | Yes | Feedback messages, word reports, word suggestions, name reports | Yes | App functionality (support, moderation) |
| App info and performance → Crash logs | Yes | Sentry error reports (frontend and API) | No | App functionality (diagnostics) |
| App info and performance → Diagnostics | Yes | Browser user-agent stored with feedback; Sentry context | No | App functionality |
| Device or other IDs | Yes | Random player ID in the `bv_anon` cookie; keyed hash of the IP for 24 h when a new ID is minted | No | App functionality, Fraud prevention/security |
| Everything else (email, phone, contacts, photos, payments, health, …) | No | | | |

- Data encrypted in transit: **yes** (HTTPS only).
- Users can request deletion: **yes**. In-app: Settings → Privacy → "Delete my data"
  (`DELETE /api/v1/me`). Deletion URL for the form: `https://betuveto.tmsso.com/privacy`.
- No account is needed, so Play's "account deletion" requirement is met by the same page.

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

- **Short description (hu, ≤80):** Rakj ki minél több szót a megkevert betűkből!
- **Short description (en, ≤80):** Make as many words as you can from scrambled letters.
- **Full description:** reuse the `og:description` / meta description from
  `frontend/index.html` and expand it with: daily puzzle, leaderboards, rooms with friends
  (co-op and versus), Hungarian and English, no sign-up, no ads.
- **Screenshots:** phone portrait at 1080×1920. These can be generated with Playwright
  against the live site: start screen, a game in progress, the daily puzzle, a room lobby.
- **Feature graphic:** 1024×500, still to be made.
- **Privacy policy URL:** `https://betuveto.tmsso.com/privacy`.
- **Terms:** `https://betuveto.tmsso.com/terms` (wording still needs the owner's sign-off).
- **Category:** Word (Games). Tags: word, puzzle, Hungarian.
- **Ads:** none. **In-app purchases:** none. **Target audience:** 13+ is the simplest choice.
  An audience including under-13s pulls in Families policy requirements.
