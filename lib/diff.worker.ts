import { computeDiff, type WhitespaceMode } from "./diff";

export type DiffRequest = {
  id: number;
  leftText: string;
  rightText: string;
  whitespace: WhitespaceMode;
};

self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, leftText, rightText, whitespace } = event.data;
  self.postMessage({ id, result: computeDiff(leftText, rightText, whitespace) });
};
