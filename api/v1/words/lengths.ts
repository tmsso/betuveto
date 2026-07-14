import { getAvailableLengths } from "../../../lib/game.ts";
import { handler } from "../../../lib/http.ts";

export default handler("GET", () => getAvailableLengths());
