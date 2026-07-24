import { mintIdentity, verifyIdentity } from "../../../lib/auth.js";
import { startGame } from "../../../lib/game.js";
import { handler, intQuery } from "../../../lib/http.js";
import { DEFAULT_TARGET_LENGTH, GAME_DURATION_SECONDS } from "../../../lib/words.js";

// 400 days: the longest Max-Age Chrome/Firefox honour, so anything larger just gets
// silently clamped anyway (ROADMAP 2.1).
const ANON_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export default handler("POST", (req) => {
  const secret = process.env.ANON_SESSION_SECRET;
  if (!secret) throw new Error("ANON_SESSION_SECRET is not set.");

  let playerId = verifyIdentity(secret, req.headers.cookie);
  let setCookieHeader: string | undefined;
  if (!playerId) {
    const minted = mintIdentity(secret);
    playerId = minted.playerId;
    setCookieHeader =
      `bv_anon=${minted.cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; ` +
      `Max-Age=${ANON_COOKIE_MAX_AGE_SECONDS}`;
  }

  return startGame(
    intQuery(req, "target_length", DEFAULT_TARGET_LENGTH),
    intQuery(req, "duration_seconds", GAME_DURATION_SECONDS),
    playerId,
    setCookieHeader,
  );
});
