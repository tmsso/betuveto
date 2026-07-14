import { getPossibleWords } from "../../../../../lib/game.js";
import { gameId, handler } from "../../../../../lib/http.js";

export default handler("GET", (req) => getPossibleWords(gameId(req)));
