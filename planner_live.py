"""Responsibility: notify readers of committed store revisions. Persistence and validation belong to planner_store."""

import asyncio
import json
import logging
from contextlib import suppress

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from planner_store import read, read_revision


class RevisionFeed:
    def __init__(self, interval=0.5, heartbeat=15, maximum=128):
        self.interval = interval
        self.heartbeat = heartbeat
        self.maximum = maximum
        self.subscribers = set()
        self.current = None
        self.task = None

    async def start(self):
        await run_in_threadpool(read)
        self.current = ("revision", await run_in_threadpool(read_revision))
        self.task = asyncio.create_task(self._watch())

    async def stop(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task

    def subscribe(self):
        if len(self.subscribers) >= self.maximum:
            raise HTTPException(503, "Live updates are at capacity. Reconnect shortly.")
        queue = asyncio.Queue(maxsize=1)
        self.subscribers.add(queue)
        queue.put_nowait(self.current)
        return queue

    def unsubscribe(self, queue):
        self.subscribers.discard(queue)

    def _publish(self, value):
        self.current = value
        for queue in self.subscribers:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(value)

    async def _watch(self):
        while True:
            await asyncio.sleep(self.interval)
            try:
                value = ("revision", await run_in_threadpool(read_revision))
            except Exception:
                value = ("unavailable", None)
                if self.current != value:
                    logging.getLogger(__name__).exception("Live revision observation failed")
            if value != self.current:
                self._publish(value)

    async def events(self, queue):
        try:
            while True:
                try:
                    kind, revision = await asyncio.wait_for(queue.get(), timeout=self.heartbeat)
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                data = json.dumps({"revision": revision}) if kind == "revision" else "{}"
                yield f"event: {kind}\ndata: {data}\n\n"
        finally:
            self.unsubscribe(queue)
