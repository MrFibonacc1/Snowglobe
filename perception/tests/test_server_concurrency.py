import asyncio
import time
import unittest

from perception.server import _offload


class ServerConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_blocking_detector_work_does_not_block_event_loop(self):
        started = time.perf_counter()
        work = asyncio.create_task(_offload(time.sleep, 0.1))

        await asyncio.sleep(0.01)

        self.assertLess(time.perf_counter() - started, 0.05)
        self.assertFalse(work.done())
        await work


if __name__ == "__main__":
    unittest.main()
