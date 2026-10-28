"""Unit tests for the Home Assistant integration's state cache (no homeassistant import)."""
import importlib.util
import unittest
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "custom_components" / "glowup" / "state_cache.py"
_spec = importlib.util.spec_from_file_location("glowup_state_cache", _PATH)
state_cache = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(state_cache)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class StateCacheTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.cache = state_cache.StateCache(self.clock)

    def test_first_send_then_skip_identical(self):
        p = {"text": "Garage ouvert", "icon": "mdi:garage-open"}
        self.assertTrue(self.cache.should_send("garage", p, 60))
        self.cache.remember("garage", p, 60)
        self.assertFalse(self.cache.should_send("garage", {"icon": "mdi:garage-open", "text": "Garage ouvert"}, 60))

    def test_changed_payload_or_ttl_is_sent(self):
        self.cache.remember("w", {"text": "a"}, 60)
        self.assertTrue(self.cache.should_send("w", {"text": "b"}, 60))
        self.assertTrue(self.cache.should_send("w", {"text": "a"}, 120))

    def test_same_payload_is_sent_again_as_keep_alive_past_half_ttl(self):
        self.cache.remember("w", {"text": "a"}, 60)
        self.clock.t += 29.9
        self.assertFalse(self.cache.should_send("w", {"text": "a"}, 60))
        self.clock.t += 0.1  # half the ttl: refresh it before the TV drops it
        self.assertTrue(self.cache.should_send("w", {"text": "a"}, 60))

    def test_ttl_zero_never_expires(self):
        self.cache.remember("w", {"text": "a"}, 0)
        self.clock.t += 10**7
        self.assertFalse(self.cache.should_send("w", {"text": "a"}, 0))
        self.assertEqual(self.cache.pending_repush(), [("w", {"text": "a"}, 0)])

    def test_forget(self):
        self.cache.remember("w", {"text": "a"}, 0)
        self.cache.forget("w")
        self.cache.forget("absent")  # no error
        self.assertTrue(self.cache.should_send("w", {"text": "a"}, 0))
        self.assertEqual(self.cache.pending_repush(), [])

    def test_pending_repush_remaining_ttl_and_expiry(self):
        self.cache.remember("short", {"text": "s"}, 30)
        self.cache.remember("long", {"text": "l"}, 100)
        self.clock.t += 20
        got = {w: (p, t) for w, p, t in self.cache.pending_repush()}
        self.assertEqual(got, {"short": ({"text": "s"}, 10), "long": ({"text": "l"}, 80)})
        self.clock.t += 10  # short expires exactly now
        got = {w: t for w, _, t in self.cache.pending_repush()}
        self.assertEqual(got, {"long": 70})
        self.assertTrue(self.cache.should_send("short", {"text": "s"}, 30))

    def test_remaining_ttl_is_at_least_one(self):
        self.cache.remember("w", {"text": "a"}, 10)
        self.clock.t += 9.9
        self.assertEqual(self.cache.pending_repush()[0][2], 1)

    def test_pending_returns_copies(self):
        self.cache.remember("w", {"text": "a"}, 0)
        self.cache.pending_repush()[0][1]["text"] = "mutated"
        self.assertEqual(self.cache.pending_repush()[0][1], {"text": "a"})


if __name__ == "__main__":
    unittest.main()
