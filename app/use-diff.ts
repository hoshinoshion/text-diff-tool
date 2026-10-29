"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { computeDiff, type DiffResult, type WhitespaceMode } from "@/lib/diff";

// Inputs up to this many characters are diffed during render, which keeps the
// first paint and server rendering complete. Larger inputs go to a worker so
// typing never waits for the diff.
const SYNC_DIFF_CHARACTER_LIMIT = 20_000;
const WORKER_DEBOUNCE_MS = 120;

type DiffInput = {
  leftText: string;
  rightText: string;
  whitespace: WhitespaceMode;
};

type WorkerResponse = { id: number; result: DiffResult };

function createDiffWorker() {
  try {
    return new Worker(new URL("../lib/diff.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

export function useDiff(
  leftText: string,
  rightText: string,
  whitespace: WhitespaceMode,
) {
  const runInline =
    leftText.length + rightText.length <= SYNC_DIFF_CHARACTER_LIMIT;
  const inlineResult = useMemo(
    () => (runInline ? computeDiff(leftText, rightText, whitespace) : null),
    [runInline, leftText, rightText, whitespace],
  );
  const [workerState, setWorkerState] = useState<
    (DiffInput & { result: DiffResult }) | null
  >(null);
  const worker = useRef<Worker | null>(null);
  const workerBusy = useRef(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    if (runInline) return;

    const id = (latestRequest.current += 1);
    const finish = (result: DiffResult) => {
      if (id !== latestRequest.current) return;
      setWorkerState({ leftText, rightText, whitespace, result });
    };
    const computeHere = () => finish(computeDiff(leftText, rightText, whitespace));

    const timer = window.setTimeout(() => {
      // A worker cannot be interrupted, so replace one that is still busy
      // with an outdated request.
      if (worker.current && workerBusy.current) {
        worker.current.terminate();
        worker.current = null;
      }
      worker.current ??= createDiffWorker();
      const currentWorker = worker.current;
      if (!currentWorker) {
        computeHere();
        return;
      }

      workerBusy.current = true;
      currentWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        workerBusy.current = false;
        if (event.data.id === id) finish(event.data.result);
      };
      currentWorker.onerror = () => {
        workerBusy.current = false;
        currentWorker.terminate();
        if (worker.current === currentWorker) worker.current = null;
        computeHere();
      };
      currentWorker.postMessage({ id, leftText, rightText, whitespace });
    }, WORKER_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [runInline, leftText, rightText, whitespace]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const workerIsCurrent =
    workerState?.leftText === leftText &&
    workerState.rightText === rightText &&
    workerState.whitespace === whitespace;

  return {
    // While a worker request is pending, keep showing the previous result.
    result: inlineResult ?? workerState?.result ?? null,
    pending: !runInline && !workerIsCurrent,
  };
}
