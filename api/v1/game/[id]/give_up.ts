import { giveUp } from "../../../../lib/game.js";
import { gameId, handler } from "../../../../lib/http.js";

export default handler("POST", (req) => giveUp(gameId(req)));
