"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Copy,
  Eraser,
  FileDiff,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  buildRows,
  countText,
  inlineDiff,
  type DiffRow,
  type Segment,
} from "@/lib/diff";

const INITIAL_LEFT = `文本对比工具可以帮助你快速发现两份内容之间的区别。
它会逐行分析文本，并用颜色标记被删除或修改的部分。
所有内容都在浏览器本地处理，不会上传到服务器。

将第一份文本粘贴到左侧，然后在右侧粘贴新版本。`;

const INITIAL_RIGHT = `文本对比工具可以帮助你快速找出两份内容之间的差异。
它会逐行分析文本，并用颜色清晰标记被新增、删除或修改的部分。
所有内容都只在浏览器本地处理，不会上传到任何服务器。

将原始文本粘贴到左侧，然后在右侧粘贴修改后的版本。
差异结果会实时更新。`;

function TextSegments({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) => (
    <span key={`${segment.kind}-${index}`} className={`token-${segment.kind}`}>
      {segment.text}
    </span>
  ));
}

function DiffLineCell({
  row,
  side,
  segments,
}: {
  row: DiffRow;
  side: "left" | "right";
  segments: ReturnType<typeof inlineDiff> | null;
}) {
  const line = row[side];
  const marker = side === "left" ? "−" : "+";

  return (
    <div
      className={`diff-cell diff-cell-${side} diff-cell-${row.kind} ${
        line ? "has-line" : "empty-line"
      }`}
    >
      <span className="line-number">{line?.number ?? ""}</span>
      <span className="line-marker" aria-hidden="true">
        {row.kind === "changed" && line ? marker : ""}
      </span>
      <code>
        {line ? (
          segments ? (
            <TextSegments segments={segments[side]} />
          ) : (
            line.text || " "
          )
        ) : (
          " "
        )}
      </code>
    </div>
  );
}

export default function Home() {
  const [leftText, setLeftText] = useState(INITIAL_LEFT);
  const [rightText, setRightText] = useState(INITIAL_RIGHT);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  const [copied, setCopied] = useState<"left" | "right" | null>(null);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const preferredEditorHeight = useRef<number | null>(null);
  const resizingViewport = useRef(false);
  const leftEditor = useRef<HTMLTextAreaElement>(null);
  const rightEditor = useRef<HTMLTextAreaElement>(null);
  const leftDiffPane = useRef<HTMLDivElement>(null);
  const rightDiffPane = useRef<HTMLDivElement>(null);
  const syncingDiffScroll = useRef(false);

  const rows = useMemo(
    () => buildRows(leftText, rightText, ignoreWhitespace),
    [leftText, rightText, ignoreWhitespace],
  );
  const detailedRows = useMemo(
    () =>
      rows.map((row) => ({
        row,
        segments:
          row.kind === "changed" && row.left && row.right
            ? inlineDiff(row.left.text, row.right.text)
            : null,
      })),
    [rows],
  );
  const leftCount = countText(leftText);
  const rightCount = countText(rightText);
  const removedLines = rows.filter((row) => row.kind === "changed" && row.left).length;
  const addedLines = rows.filter((row) => row.kind === "changed" && row.right).length;
  const changedRows = rows.filter((row) => row.kind === "changed").length;

  useEffect(() => {
    const left = leftEditor.current;
    const right = rightEditor.current;
    if (!left || !right) return;

    const clampHeight = (height: number) => {
      const computedStyle = window.getComputedStyle(left);
      const minimumHeight = Number.parseFloat(computedStyle.minHeight) || 170;
      const parsedMaximum = Number.parseFloat(computedStyle.maxHeight);
      const maximumHeight = Number.isFinite(parsedMaximum)
        ? parsedMaximum
        : window.innerHeight * 0.8;
      return Math.min(maximumHeight, Math.max(minimumHeight, Math.round(height)));
    };

    const observer = new ResizeObserver((entries) => {
      if (resizingViewport.current) return;

      const leftHeight = left.getBoundingClientRect().height;
      const rightHeight = right.getBoundingClientRect().height;
      if (Math.abs(leftHeight - rightHeight) <= 1) return;

      const resizedEntry = entries.find(
        (entry) => entry.target === left || entry.target === right,
      );
      if (!resizedEntry) return;

      const requestedHeight = resizedEntry.target.getBoundingClientRect().height;
      preferredEditorHeight.current = requestedHeight;
      setEditorHeight(clampHeight(requestedHeight));
    });

    let firstFrame = 0;
    let secondFrame = 0;
    const handleViewportResize = () => {
      resizingViewport.current = true;
      const preferredHeight = preferredEditorHeight.current;
      setEditorHeight(
        preferredHeight === null ? null : clampHeight(preferredHeight),
      );

      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          resizingViewport.current = false;
        });
      });
    };

    observer.observe(left);
    observer.observe(right);
    window.addEventListener("resize", handleViewportResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleViewportResize);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  const swapTexts = () => {
    setLeftText(rightText);
    setRightText(leftText);
  };

  const clearTexts = () => {
    setLeftText("");
    setRightText("");
  };

  const copyText = async (side: "left" | "right") => {
    const text = side === "left" ? leftText : rightText;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(side);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      toast.error("复制失败，请手动选择文本复制。", {
        description: "浏览器可能未授予剪贴板权限。",
      });
    }
  };

  const syncEditorScroll = (
    source: HTMLTextAreaElement,
    target: HTMLTextAreaElement | null,
  ) => {
    if (!target || source.scrollHeight <= source.clientHeight) return;
    const progress = source.scrollTop / (source.scrollHeight - source.clientHeight);
    target.scrollTop = progress * (target.scrollHeight - target.clientHeight);
  };

  const syncDiffScroll = (
    source: HTMLDivElement,
    target: HTMLDivElement | null,
  ) => {
    if (!target || syncingDiffScroll.current) return;
    syncingDiffScroll.current = true;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingDiffScroll.current = false;
    });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <FileDiff size={19} strokeWidth={2.2} />
          </span>
          <div>
            <h1>文本对比工具</h1>
            <p>粘贴两份文本，立即看见每一处变化</p>
          </div>
        </div>
        <div className="privacy-note">
          <LockKeyhole size={14} aria-hidden="true" />
          仅在当前浏览器中处理
        </div>
      </header>

      <section className="workspace" aria-label="文本对比工作区">
        <div className="toolbar">
          <div className="toolbar-actions">
            <Button variant="outline" size="sm" onClick={swapTexts}>
              <ArrowLeftRight size={15} aria-hidden="true" />
              交换两侧
            </Button>
            <Button variant="ghost" size="sm" onClick={clearTexts}>
              <Eraser size={15} aria-hidden="true" />
              清空
            </Button>
          </div>
          <div className="toolbar-options">
            <label className="switch-option">
              <Switch
                checked={ignoreWhitespace}
                onCheckedChange={setIgnoreWhitespace}
                aria-label="忽略空白差异"
              />
              忽略空白
            </label>
            <label className="switch-option">
              <Switch
                checked={wrapLines}
                onCheckedChange={setWrapLines}
                aria-label="自动换行"
              />
              自动换行
            </label>
          </div>
        </div>

        <div className="editor-grid">
          <article className="editor-panel editor-panel-left">
            <div className="panel-heading">
              <div className="panel-title">
                <span className="side-dot side-dot-left" />
                原始文本
                <span className="side-key">A</span>
              </div>
              <div className="panel-meta">
                {leftCount.lines} 行 · {leftCount.characters} 字符
                <Button
                  variant="ghost"
                  size="sm"
                  className="panel-clear-button"
                  type="button"
                  onClick={() => setLeftText("")}
                  disabled={!leftText}
                  aria-label="清空原始文本"
                  title="只清空左侧原始文本"
                >
                  <Eraser size={13} aria-hidden="true" />
                  清空
                </Button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => copyText("left")}
                  aria-label="复制原始文本"
                  title="复制原始文本"
                >
                  {copied === "left" ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
            <textarea
              ref={leftEditor}
              style={editorHeight ? { height: `${editorHeight}px` } : undefined}
              value={leftText}
              onChange={(event) => setLeftText(event.target.value)}
              onScroll={(event) => syncEditorScroll(event.currentTarget, rightEditor.current)}
              placeholder="在这里粘贴原始文本…"
              aria-label="原始文本"
              spellCheck={false}
            />
          </article>

          <article className="editor-panel editor-panel-right">
            <div className="panel-heading">
              <div className="panel-title">
                <span className="side-dot side-dot-right" />
                修改后文本
                <span className="side-key">B</span>
              </div>
              <div className="panel-meta">
                {rightCount.lines} 行 · {rightCount.characters} 字符
                <Button
                  variant="ghost"
                  size="sm"
                  className="panel-clear-button"
                  type="button"
                  onClick={() => setRightText("")}
                  disabled={!rightText}
                  aria-label="清空修改后文本"
                  title="只清空右侧修改后文本"
                >
                  <Eraser size={13} aria-hidden="true" />
                  清空
                </Button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => copyText("right")}
                  aria-label="复制修改后文本"
                  title="复制修改后文本"
                >
                  {copied === "right" ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
            <textarea
              ref={rightEditor}
              style={editorHeight ? { height: `${editorHeight}px` } : undefined}
              value={rightText}
              onChange={(event) => setRightText(event.target.value)}
              onScroll={(event) => syncEditorScroll(event.currentTarget, leftEditor.current)}
              placeholder="在这里粘贴修改后的文本…"
              aria-label="修改后文本"
              spellCheck={false}
            />
          </article>
        </div>

        <section className="diff-card" aria-label="差异结果">
          <div className="diff-heading">
            <div>
              <div className="diff-title-row">
                <h2>差异结果</h2>
              </div>
              <p>浅色标记整行变化，深色标记具体变化的文字</p>
            </div>
            <div className="diff-stats" aria-label="差异统计">
              <span className="stat stat-removed">− {removedLines}</span>
              <span className="stat stat-added">+ {addedLines}</span>
              <span className="stat stat-total">{changedRows} 行差异</span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                <FileDiff size={24} />
              </span>
              <strong>等待文本</strong>
              <p>将需要比较的内容粘贴到上方左右两侧。</p>
            </div>
          ) : changedRows === 0 ? (
            <div className="empty-state success-state">
              <span className="empty-icon" aria-hidden="true">
                <Check size={24} />
              </span>
              <strong>两份文本完全一致</strong>
              <p>当前设置下没有发现任何差异。</p>
            </div>
          ) : (
            <div className={`diff-table ${wrapLines ? "wrap-lines" : "no-wrap-lines"}`}>
              {wrapLines ? (
                <div className="diff-scroll">
                  <div className="diff-rows">
                    <div className="diff-column-labels" aria-hidden="true">
                      <span>原始文本</span>
                      <span>修改后文本</span>
                    </div>
                    {detailedRows.map(({ row, segments }, index) => (
                      <div className={`diff-row diff-row-${row.kind}`} key={index}>
                        <DiffLineCell row={row} side="left" segments={segments} />
                        <DiffLineCell row={row} side="right" segments={segments} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="parallel-diff">
                  <div className="diff-pane-group">
                    <div className="diff-pane-label">原始文本</div>
                    <div
                      className="diff-pane"
                      ref={leftDiffPane}
                      onScroll={(event) =>
                        syncDiffScroll(event.currentTarget, rightDiffPane.current)
                      }
                    >
                      <div className="diff-pane-content">
                        {detailedRows.map(({ row, segments }, index) => (
                          <div className={`diff-pane-row diff-row-${row.kind}`} key={index}>
                            <DiffLineCell row={row} side="left" segments={segments} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="diff-pane-group">
                    <div className="diff-pane-label">修改后文本</div>
                    <div
                      className="diff-pane"
                      ref={rightDiffPane}
                      onScroll={(event) =>
                        syncDiffScroll(event.currentTarget, leftDiffPane.current)
                      }
                    >
                      <div className="diff-pane-content">
                        {detailedRows.map(({ row, segments }, index) => (
                          <div className={`diff-pane-row diff-row-${row.kind}`} key={index}>
                            <DiffLineCell row={row} side="right" segments={segments} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </section>
      <Toaster position="bottom-center" richColors />
    </main>
  );
}
