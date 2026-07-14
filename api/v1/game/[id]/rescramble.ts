import { rescramble } from "../../../../lib/game.ts";
import { gameId, handler } from "../../../../lib/http.ts";

export default handler("POST", (req) => rescramble(gameId(req)));
