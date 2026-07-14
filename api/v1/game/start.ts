import { startGame } from "../../../lib/game.ts";
import { handler, intQuery } from "../../../lib/http.ts";
import { DEFAULT_TARGET_LENGTH, GAME_DURATION_SECONDS } from "../../../lib/words.ts";

export default handler("POST", (req) =>
  startGame(
    intQuery(req, "target_length", DEFAULT_TARGET_LENGTH),
    intQuery(req, "duration_seconds", GAME_DURATION_SECONDS),
  ),
);
