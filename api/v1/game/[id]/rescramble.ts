import { rescramble } from "../../../../lib/game.js";
import { gameId, handler } from "../../../../lib/http.js";

export default handler("POST", (req) => rescramble(gameId(req)));
