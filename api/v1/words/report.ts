import { verifyIdentity } from "../../../lib/auth.js";
import { DEFAULT_WORDLIST_CODE } from "../../../lib/db.js";
import { bodyField, handler } from "../../../lib/http.js";
import { reportWord } from "../../../lib/word-reports.js";

export default handler("POST", (req) => {
  const secret = process.env.ANON_SESSION_SECRET;
  const playerId = secret ? verifyIdentity(secret, req.headers.cookie) : null;

  const wordlistField = bodyField(req, "wordlist");
  const wordlistCode = typeof wordlistField === "string" ? wordlistField : DEFAULT_WORDLIST_CODE;

  return reportWord(playerId, bodyField(req, "word"), wordlistCode, bodyField(req, "reason"));
});
