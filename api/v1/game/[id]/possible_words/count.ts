import { getPossibleCount } from "../../../../../lib/game.js";
import { gameId, handler } from "../../../../../lib/http.js";

export default handler("GET", (req) => getPossibleCount(gameId(req)));
