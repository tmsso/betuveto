import { guess } from "../../../../lib/game.js";
import { bodyWord, gameId, handler } from "../../../../lib/http.js";

export default handler("POST", (req) => guess(gameId(req), bodyWord(req)));
