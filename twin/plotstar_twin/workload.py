"""The real AI workload: worker processes that train a small neural network on the CPU.

Worker 0 is the always-on tier (inference). Workers 1..N-1 are the flexible tier.
Each worker is a separate process pinned to one BLAS thread, so "N workers on" maps to
a clean, repeatable power step on the chip. Turning a worker off pauses it (no restart cost).
"""
from __future__ import annotations

import multiprocessing as mp
import os
import time

THREAD_ENV = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
              "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS")


def _train_loop(run, stop, counter) -> None:  # runs in a child process
    import signal

    signal.signal(signal.SIGINT, signal.SIG_IGN)  # Ctrl-C is handled by the parent: clean exit, no tracebacks
    import numpy as np

    rng = np.random.default_rng(os.getpid())
    X = rng.standard_normal((512, 256)).astype(np.float32)
    y = rng.integers(0, 10, 512)
    Y = np.eye(10, dtype=np.float32)[y]
    W1 = rng.standard_normal((256, 512)).astype(np.float32) * 0.05
    W2 = rng.standard_normal((512, 10)).astype(np.float32) * 0.05
    lr = 1e-3
    while not stop.is_set():
        if not run.wait(0.1):
            continue
        h = np.maximum(X @ W1, 0.0)                     # forward
        logits = h @ W2
        p = np.exp(logits - logits.max(1, keepdims=True))
        p /= p.sum(1, keepdims=True)
        g = (p - Y) / len(X)                            # backward (softmax cross-entropy)
        gW2 = h.T @ g
        gh = (g @ W2.T) * (h > 0)
        gW1 = X.T @ gh
        W1 -= lr * gW1
        W2 -= lr * gW2
        with counter.get_lock():
            counter.value += 1


class WorkerPool:
    def __init__(self, n_workers: int = 4):
        if n_workers < 1:
            raise ValueError("need at least one worker")
        for k in THREAD_ENV:  # inherited by the spawned children
            os.environ[k] = "1"
        ctx = mp.get_context("spawn")
        self.n = n_workers
        self._stop = ctx.Event()
        self._run = [ctx.Event() for _ in range(n_workers)]
        self._count = [ctx.Value("Q", 0) for _ in range(n_workers)]
        self._procs = [ctx.Process(target=_train_loop, args=(self._run[i], self._stop, self._count[i]),
                                   name=f"ai-worker-{i}", daemon=True) for i in range(n_workers)]
        self.active = 0

    def start(self) -> "WorkerPool":
        for p in self._procs:
            p.start()
        time.sleep(1.0)  # let children import numpy before we start measuring
        return self

    def set_active(self, n: int) -> None:
        n = max(0, min(self.n, int(n)))
        for i, ev in enumerate(self._run):
            ev.set() if i < n else ev.clear()
        self.active = n

    def batches(self) -> int:
        return sum(c.value for c in self._count)

    def stop(self) -> None:
        self.set_active(0)
        self._stop.set()
        for p in self._procs:
            p.join(timeout=2)
            if p.is_alive():
                p.terminate()


class FakePool:
    """Drop-in for tests and for running the twin without loading the CPU."""

    def __init__(self, n_workers: int = 4):
        self.n, self.active, self._b = n_workers, 0, 0

    def start(self):
        return self

    def set_active(self, n: int) -> None:
        self.active = max(0, min(self.n, int(n)))
        self._b += self.active

    def batches(self) -> int:
        return self._b

    def stop(self) -> None:
        self.active = 0
