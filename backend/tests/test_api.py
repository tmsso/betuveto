"""
HTTP-surface tests for the Betűvető API.

These are intentionally black-box (request/response) where they assert the
public contract — no leaked solution, enforced timer, validated input — so they
can be translated to the TypeScript port (Batch 1) unchanged in meaning. A few
tests peek at internal game state (the target word) purely to construct a
deterministic guess; that is white-box scaffolding, not part of the contract.
"""

import time

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client():
    return TestClient(main.app)


def _start(client, length=7):
    response = client.post("/api/game/start", params={"target_length": length})
    assert response.status_code == 200
    return response.json()


def _start_with_multiple(client, length=7, tries=10):
    """Start a game that has at least two findable words (avoids ending the
    game on the first guess in dedup tests)."""
    data = _start(client, length)
    for _ in range(tries):
        if data["possible_count"] >= 2:
            break
        data = _start(client, length)
    return data


# --- No solution leaks -----------------------------------------------------
def test_start_does_not_leak_solution(client):
    data = _start(client)
    assert "target_word" not in data
    assert "current_word" not in data
    assert "possible_words" not in data
    assert data["possible_count"] >= 1
    assert "ends_at" in data
    assert "game_id" in data


def test_state_does_not_leak_solution(client):
    gid = _start(client)["game_id"]
    state = client.get(f"/api/game/{gid}").json()
    assert "target_word" not in state
    assert "current_word" not in state


def test_possible_words_blocked_while_active(client):
    gid = _start(client)["game_id"]
    assert client.get(f"/api/game/{gid}/possible_words").status_code == 403


def test_possible_count_available_while_active(client):
    data = _start(client)
    gid = data["game_id"]
    count = client.get(f"/api/game/{gid}/possible_words/count").json()
    assert count["possible_count"] == data["possible_count"]


# --- Scoring & guessing ----------------------------------------------------
def test_target_word_scores_and_flags(client):
    data = _start(client)
    gid = data["game_id"]
    target = main.manager.games[gid].target_word
    result = client.post(f"/api/game/{gid}/guess", json={"word": target}).json()
    assert result["valid"] and result["can_form"]
    assert not result["already_guessed"]
    assert result["score"] == len(target) ** 2
    assert result["is_target"] is True
    assert result["is_full_length"] is True


def test_duplicate_guess_scores_zero(client):
    data = _start_with_multiple(client)
    gid = data["game_id"]
    word = sorted(main.manager.games[gid].possible_words)[0]
    first = client.post(f"/api/game/{gid}/guess", json={"word": word}).json()
    assert first["score"] == len(word) ** 2
    second = client.post(f"/api/game/{gid}/guess", json={"word": word}).json()
    assert second["already_guessed"] is True
    assert second["score"] == 0


def test_unknown_word_rejected(client):
    gid = _start(client)["game_id"]
    result = client.post(f"/api/game/{gid}/guess", json={"word": "QWXZQWX"}).json()
    assert result["valid"] is False
    assert result["can_form"] is False


def test_minimum_word_length_enforced(client):
    gid = _start(client)["game_id"]
    result = client.post(f"/api/game/{gid}/guess", json={"word": "AB"}).json()
    assert result["valid"] is False
    assert "Legalább" in result["message"]


# --- Input validation & unknown games --------------------------------------
def test_invalid_target_length_rejected(client):
    assert client.post("/api/game/start", params={"target_length": 4}).status_code == 422
    assert client.post("/api/game/start", params={"target_length": 11}).status_code == 422


def test_unknown_game_id_returns_404(client):
    assert client.post("/api/game/nope/guess", json={"word": "ALMA"}).status_code == 404
    assert client.get("/api/game/nope").status_code == 404
    assert client.get("/api/game/nope/possible_words").status_code == 404
    assert client.post("/api/game/nope/rescramble").status_code == 404


# --- Server-enforced timer -------------------------------------------------
def test_timer_expiry_rejects_guesses(client):
    data = _start(client)
    gid = data["game_id"]
    target = main.manager.games[gid].target_word
    # Force the deadline into the past.
    main.manager.games[gid].ends_at = time.time() - 1
    result = client.post(f"/api/game/{gid}/guess", json={"word": target}).json()
    assert result["game_ended"] is True
    assert result["score"] == 0
    # The full solution list is available once the game is over.
    assert client.get(f"/api/game/{gid}/possible_words").status_code == 200


# --- Give up ---------------------------------------------------------------
def test_give_up_reveals_and_unlocks(client):
    data = _start(client)
    gid = data["game_id"]
    target = main.manager.games[gid].target_word
    revealed = client.post(f"/api/game/{gid}/give_up").json()
    assert revealed["target_word"] == target
    assert target in revealed["possible_words"]
    assert client.get(f"/api/game/{gid}/possible_words").status_code == 200
    # No further scoring once the game is over.
    assert client.post(f"/api/game/{gid}/guess", json={"word": target}).status_code == 400


# --- Two players do not clobber each other ---------------------------------
def test_concurrent_games_are_isolated(client):
    a = _start(client)["game_id"]
    b = _start(client)["game_id"]
    assert a != b
    target_a = main.manager.games[a].target_word
    # Guessing in game A must not affect game B's state.
    client.post(f"/api/game/{a}/guess", json={"word": target_a})
    assert client.get(f"/api/game/{b}").json()["found_count"] == 0


# --- can-form logic (accents & double letters) -----------------------------
def test_can_form_word_accents_and_doubles():
    can_form = main.GameManager._can_form_word
    assert can_form("KÖR", "KÖRÖM") is True       # accented Ö available
    assert can_form("ALMA", "ALMA") is True        # exact multiset
    assert can_form("AA", "A") is False            # needs two A, one available
    assert can_form("ÁÉ", "ÉÁ") is True            # accents counted distinctly
    assert can_form("Ő", "O") is False             # Ő is not O
