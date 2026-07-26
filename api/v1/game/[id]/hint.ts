import { useHint } from "../../../../lib/hints.js";
import { gameId, handler } from "../../../../lib/http.js";

export default handler("POST", (req) => useHint(gameId(req)));
