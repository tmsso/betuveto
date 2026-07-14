import { getWordCount } from "../../../lib/game.js";
import { handler } from "../../../lib/http.js";

export default handler("GET", () => getWordCount());
