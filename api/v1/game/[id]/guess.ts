import { guess } from "../../../../lib/game.ts";
import { bodyWord, gameId, handler } from "../../../../lib/http.ts";

export default handler("POST", (req) => guess(gameId(req), bodyWord(req)));
