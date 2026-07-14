import { getState } from "../../../../lib/game.js";
import { gameId, handler } from "../../../../lib/http.js";

export default handler("GET", (req) => getState(gameId(req)));
