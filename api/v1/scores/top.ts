import { verifyIdentity } from "../../../lib/auth.js";
import { DEFAULT_WORDLIST_CODE } from "../../../lib/db.js";
import { handler, intQuery, stringQuery } from "../../../lib/http.js";
import { getTopScores } from "../../../lib/scores.js";
import { DEFAULT_TARGET_LENGTH } from "../../../lib/words.js";

export default handler("GET", (req) => {
  const secret = process.env.ANON_SESSION_SECRET;
  // Missing secret degrades to "no personal best" rather than 500 — the leaderboard
  // itself needs no identity at all.
  const playerId = secret ? verifyIdentity(secret, req.headers.cookie) : null;

  return getTopScores(
    intQuery(req, "length", DEFAULT_TARGET_LENGTH),
    stringQuery(req, "wordlist", DEFAULT_WORDLIST_CODE),
    stringQuery(req, "period", "all"),
    playerId,
  );
});
