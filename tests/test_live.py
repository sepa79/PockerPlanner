import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.exceptions import HTTPException
from starlette.testclient import TestClient

import planner_commands
import planner_store
from planner_live import RevisionFeed
from server import create_app


class LiveTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_database = planner_store.DATABASE
        planner_store.DATABASE = Path(self.directory.name) / "planner.sqlite3"
        self.feed = RevisionFeed(interval=0.01, heartbeat=0.03, maximum=2)
        await self.feed.start()

    async def asyncTearDown(self):
        await self.feed.stop()
        planner_store.DATABASE = self.original_database
        self.directory.cleanup()

    async def take(self, queue):
        return await asyncio.wait_for(queue.get(), 2)

    async def test_committed_ui_scoped_and_external_replacements_are_observed(self):
        first = self.feed.subscribe()
        second = self.feed.subscribe()
        self.assertEqual(await self.take(first), ("revision", 0))
        await self.take(second)
        planner_store.write(planner_store.read())
        self.assertEqual(await self.take(first), ("revision", 1))
        self.assertEqual(await self.take(second), ("revision", 1))
        planner_commands.create_plan("live", "Live", "", 1)
        self.assertEqual(await self.take(first), ("revision", 2))
        planner_store.replace_explicitly({"schemaVersion": 1, "revision": 0, "plans": []})
        self.assertEqual(await self.take(first), ("revision", 3))
        await asyncio.sleep(0.04)
        self.assertEqual(second.qsize(), 1)
        self.assertEqual(await self.take(second), ("revision", 3))

    async def test_failed_save_emits_nothing_and_does_not_advance_revision(self):
        queue = self.feed.subscribe()
        await self.take(queue)
        with self.assertRaises(planner_store.InvalidState):
            planner_store.write({"schemaVersion": 1, "revision": 0, "plans": [{"id": "bad"}]})
        await asyncio.sleep(0.04)
        self.assertTrue(queue.empty())
        self.assertEqual(planner_store.read_revision(), 0)

    async def test_outage_is_explicit_and_recovery_renotifies_same_revision(self):
        queue = self.feed.subscribe()
        await self.take(queue)
        with patch("planner_live.read_revision", side_effect=planner_store.InvalidState("Unavailable")):
            with self.assertLogs("planner_live", level="ERROR"):
                self.assertEqual(await self.take(queue), ("unavailable", None))
        self.assertEqual(await self.take(queue), ("revision", 0))

    async def test_heartbeat_bounded_connections_and_generator_cleanup(self):
        queue = self.feed.subscribe()
        second = self.feed.subscribe()
        with self.assertRaises(HTTPException) as caught:
            self.feed.subscribe()
        self.assertEqual(caught.exception.status_code, 503)
        events = self.feed.events(queue)
        self.assertIn('data: {"revision": 0}', await anext(events))
        self.assertEqual(await anext(events), ": heartbeat\n\n")
        await events.aclose()
        self.feed.unsubscribe(second)
        self.assertFalse(self.feed.subscribers)


class LiveEndpointTests(unittest.TestCase):
    def test_public_read_only_stream_headers_and_assets(self):
        async def one_event(feed, queue):
            try:
                yield 'event: revision\ndata: {"revision": 0}\n\n'
            finally:
                feed.unsubscribe(queue)

        with tempfile.TemporaryDirectory() as directory, patch.object(planner_store, "DATABASE", Path(directory) / "planner.sqlite3"), patch.object(RevisionFeed, "events", one_event):
            with TestClient(create_app(), base_url="http://localhost") as client:
                before = planner_store.read()
                response = client.get("/api/events")
                self.assertEqual(response.status_code, 200)
                self.assertIn("text/event-stream", response.headers["content-type"])
                self.assertEqual(response.headers["x-accel-buffering"], "no")
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(client.put("/api/events").status_code, 404)
                for asset in ("live.js", "whatif.js"):
                    self.assertEqual(client.get("/" + asset).status_code, 200)
                self.assertEqual(planner_store.read(), before)


if __name__ == "__main__":
    unittest.main()
