import { getPossibleCount } from "../../../../../lib/game.ts";
import { gameId, handler } from "../../../../../lib/http.ts";

export default handler("GET", (req) => getPossibleCount(gameId(req)));
