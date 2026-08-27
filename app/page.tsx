"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeftRight,
  Check,
  Copy,
  Eraser,
  FileDiff,
  Languages,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useInitialLocale } from "@/app/locale-provider";
import {
  buildRows,
  countText,
  inlineDiff,
  type DiffRow,
  type Segment,
} from "@/lib/diff";
import {
  isLocale,
  LANGUAGE_COOKIE_KEY,
  LANGUAGE_STORAGE_KEY,
  type Locale,
} from "@/lib/locale";

const LANGUAGE_CHANGE_EVENT = "text-diff-tool-language-change";
let sessionLocale: Locale | null = null;

const PRESET_TEXTS: Record<Locale, { left: string; right: string }> = {
  en: {
    left: `Text Diff Tool helps you quickly spot differences between two versions of text.
It compares the content line by line and highlights removed or modified parts.
Everything is processed locally in your browser and is never uploaded to a server.

Paste the first version on the left, then paste the new version on the right.`,
    right: `Text Diff Tool helps you quickly find every difference between two versions of text.
It compares the content line by line and clearly highlights added, removed, or modified parts.
Everything is processed only in your browser and is never uploaded to any server.

Paste the original text on the left, then paste the revised version on the right.
The diff updates in real time.`,
  },
  "zh-CN": {
    left: `文本对比工具可以帮助你快速发现两份内容之间的区别。
它会逐行分析文本，并用颜色标记被删除或修改的部分。
所有内容都在浏览器本地处理，不会上传到服务器。

将第一份文本粘贴到左侧，然后在右侧粘贴新版本。`,
    right: `文本对比工具可以帮助你快速找出两份内容之间的差异。
它会逐行分析文本，并用颜色清晰标记被新增、删除或修改的部分。
所有内容都只在浏览器本地处理，不会上传到任何服务器。

将原始文本粘贴到左侧，然后在右侧粘贴修改后的版本。
差异结果会实时更新。`,
  },
};

const translations = {
  en: {
    title: "Text Diff Tool",
    description:
      "Compare two texts side by side in your browser and highlight additions, deletions, and changes.",
    tagline: "Paste two texts and see every change instantly",
    privacy: "Processed only in this browser",
    languageLabel: "Language",
    workspaceLabel: "Text comparison workspace",
    swap: "Swap sides",
    clear: "Clear",
    ignoreWhitespace: "Ignore whitespace",
    wrapLines: "Wrap lines",
    original: "Original text",
    revised: "Revised text",
    clearOriginal: "Clear original text",
    clearOriginalTitle: "Clear only the original text on the left",
    clearRevised: "Clear revised text",
    clearRevisedTitle: "Clear only the revised text on the right",
    copyOriginal: "Copy original text",
    copyRevised: "Copy revised text",
    originalPlaceholder: "Paste the original text here…",
    revisedPlaceholder: "Paste the revised text here…",
    diffResult: "Diff result",
    diffDescription:
      "Light colors mark changed lines; darker colors mark the exact changed text",
    diffStatsLabel: "Diff statistics",
    waiting: "Waiting for text",
    waitingDescription: "Paste the content to compare into the two panels above.",
    identical: "The two texts are identical",
    identicalDescription: "No differences were found with the current settings.",
    copyFailure: "Copy failed. Select the text and copy it manually.",
    clipboardPermission: "The browser may not have granted clipboard permission.",
    textCount: (lines: number, characters: number) =>
      `${lines} ${lines === 1 ? "line" : "lines"} · ${characters} ${
        characters === 1 ? "character" : "characters"
      }`,
    changedLines: (count: number) =>
      `${count} changed ${count === 1 ? "line" : "lines"}`,
  },
  "zh-CN": {
    title: "文本对比工具",
    description: "在浏览器中并排比较两份文本，高亮显示新增、删除和修改的内容。",
    tagline: "粘贴两份文本，立即看见每一处变化",
    privacy: "仅在当前浏览器中处理",
    languageLabel: "语言",
    workspaceLabel: "文本对比工作区",
    swap: "交换两侧",
    clear: "清空",
    ignoreWhitespace: "忽略空白",
    wrapLines: "自动换行",
    original: "原始文本",
    revised: "修改后文本",
    clearOriginal: "清空原始文本",
    clearOriginalTitle: "只清空左侧原始文本",
    clearRevised: "清空修改后文本",
    clearRevisedTitle: "只清空右侧修改后文本",
    copyOriginal: "复制原始文本",
    copyRevised: "复制修改后文本",
    originalPlaceholder: "在这里粘贴原始文本…",
    revisedPlaceholder: "在这里粘贴修改后的文本…",
    diffResult: "差异结果",
    diffDescription: "浅色标记整行变化，深色标记具体变化的文字",
    diffStatsLabel: "差异统计",
    waiting: "等待文本",
    waitingDescription: "将需要比较的内容粘贴到上方左右两侧。",
    identical: "两份文本完全一致",
    identicalDescription: "当前设置下没有发现任何差异。",
    copyFailure: "复制失败，请手动选择文本复制。",
    clipboardPermission: "浏览器可能未授予剪贴板权限。",
    textCount: (lines: number, characters: number) =>
      `${lines} 行 · ${characters} 字符`,
    changedLines: (count: number) => `${count} 行差异`,
  },
} satisfies Record<Locale, Record<string, unknown>>;

function getPreferredLocale(): Locale {
  try {
    const savedLocale = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLocale(savedLocale)) return savedLocale;
  } catch {
    // Continue with the language cookie when storage is unavailable.
  }

  const cookieLocale = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${LANGUAGE_COOKIE_KEY}=`))
    ?.split("=", 2)[1];
  if (isLocale(cookieLocale)) return cookieLocale;

  if (sessionLocale) return sessionLocale;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function subscribeToLocale(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== LANGUAGE_STORAGE_KEY) return;
    sessionLocale = null;
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  };
}

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
  const initialLocale = useInitialLocale();
  const getServerLocale = useCallback(() => initialLocale, [initialLocale]);
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getPreferredLocale,
    getServerLocale,
  );
  const [editedTexts, setEditedTexts] = useState<{
    left: string;
    right: string;
  } | null>(null);
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
  const t = translations[locale];
  const { left: leftText, right: rightText } = editedTexts ?? PRESET_TEXTS[locale];

  const setLeftText = (text: string) => {
    setEditedTexts((currentTexts) => ({
      left: text,
      right: (currentTexts ?? PRESET_TEXTS[locale]).right,
    }));
  };

  const setRightText = (text: string) => {
    setEditedTexts((currentTexts) => ({
      left: (currentTexts ?? PRESET_TEXTS[locale]).left,
      right: text,
    }));
  };

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
    document.documentElement.lang = locale;
    document.title = t.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t.description);
    document.cookie = `${LANGUAGE_COOKIE_KEY}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [locale, t.description, t.title]);

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

  const selectLanguage = (nextLocale: Locale) => {
    sessionLocale = nextLocale;
    document.cookie = `${LANGUAGE_COOKIE_KEY}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
    } catch {
      // The selection still applies for this session when storage is unavailable.
    }
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
  };

  const swapTexts = () => {
    setEditedTexts({ left: rightText, right: leftText });
  };

  const clearTexts = () => {
    setEditedTexts({ left: "", right: "" });
  };

  const copyText = async (side: "left" | "right") => {
    const text = side === "left" ? leftText : rightText;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(side);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      toast.error(t.copyFailure, {
        description: t.clipboardPermission,
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
            <h1>{t.title}</h1>
            <p>{t.tagline}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div
            className="language-switch"
            role="group"
            aria-label={t.languageLabel}
          >
            <Languages className="language-icon" size={14} aria-hidden="true" />
            <button
              type="button"
              className={locale === "en" ? "is-active" : undefined}
              aria-pressed={locale === "en"}
              onClick={() => selectLanguage("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={locale === "zh-CN" ? "is-active" : undefined}
              aria-pressed={locale === "zh-CN"}
              onClick={() => selectLanguage("zh-CN")}
            >
              中文
            </button>
          </div>
          <div className="privacy-note">
            <LockKeyhole size={14} aria-hidden="true" />
            {t.privacy}
          </div>
        </div>
      </header>

      <section className="workspace" aria-label={t.workspaceLabel}>
        <div className="toolbar">
          <div className="toolbar-actions">
            <Button variant="outline" size="sm" onClick={swapTexts}>
              <ArrowLeftRight size={15} aria-hidden="true" />
              {t.swap}
            </Button>
            <Button variant="ghost" size="sm" onClick={clearTexts}>
              <Eraser size={15} aria-hidden="true" />
              {t.clear}
            </Button>
          </div>
          <div className="toolbar-options">
            <label className="switch-option">
              <Switch
                checked={ignoreWhitespace}
                onCheckedChange={setIgnoreWhitespace}
                aria-label={t.ignoreWhitespace}
              />
              {t.ignoreWhitespace}
            </label>
            <label className="switch-option">
              <Switch
                checked={wrapLines}
                onCheckedChange={setWrapLines}
                aria-label={t.wrapLines}
              />
              {t.wrapLines}
            </label>
          </div>
        </div>

        <div className="editor-grid">
          <article className="editor-panel editor-panel-left">
            <div className="panel-heading">
              <div className="panel-title">
                <span className="side-dot side-dot-left" />
                {t.original}
                <span className="side-key">A</span>
              </div>
              <div className="panel-meta">
                {t.textCount(leftCount.lines, leftCount.characters)}
                <Button
                  variant="ghost"
                  size="sm"
                  className="panel-clear-button"
                  type="button"
                  onClick={() => setLeftText("")}
                  disabled={!leftText}
                  aria-label={t.clearOriginal}
                  title={t.clearOriginalTitle}
                >
                  <Eraser size={13} aria-hidden="true" />
                  {t.clear}
                </Button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => copyText("left")}
                  aria-label={t.copyOriginal}
                  title={t.copyOriginal}
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
              placeholder={t.originalPlaceholder}
              aria-label={t.original}
              spellCheck={false}
            />
          </article>

          <article className="editor-panel editor-panel-right">
            <div className="panel-heading">
              <div className="panel-title">
                <span className="side-dot side-dot-right" />
                {t.revised}
                <span className="side-key">B</span>
              </div>
              <div className="panel-meta">
                {t.textCount(rightCount.lines, rightCount.characters)}
                <Button
                  variant="ghost"
                  size="sm"
                  className="panel-clear-button"
                  type="button"
                  onClick={() => setRightText("")}
                  disabled={!rightText}
                  aria-label={t.clearRevised}
                  title={t.clearRevisedTitle}
                >
                  <Eraser size={13} aria-hidden="true" />
                  {t.clear}
                </Button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => copyText("right")}
                  aria-label={t.copyRevised}
                  title={t.copyRevised}
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
              placeholder={t.revisedPlaceholder}
              aria-label={t.revised}
              spellCheck={false}
            />
          </article>
        </div>

        <section className="diff-card" aria-label={t.diffResult}>
          <div className="diff-heading">
            <div>
              <div className="diff-title-row">
                <h2>{t.diffResult}</h2>
              </div>
              <p>{t.diffDescription}</p>
            </div>
            <div className="diff-stats" aria-label={t.diffStatsLabel}>
              <span className="stat stat-removed">− {removedLines}</span>
              <span className="stat stat-added">+ {addedLines}</span>
              <span className="stat stat-total">{t.changedLines(changedRows)}</span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                <FileDiff size={24} />
              </span>
              <strong>{t.waiting}</strong>
              <p>{t.waitingDescription}</p>
            </div>
          ) : changedRows === 0 ? (
            <div className="empty-state success-state">
              <span className="empty-icon" aria-hidden="true">
                <Check size={24} />
              </span>
              <strong>{t.identical}</strong>
              <p>{t.identicalDescription}</p>
            </div>
          ) : (
            <div className={`diff-table ${wrapLines ? "wrap-lines" : "no-wrap-lines"}`}>
              {wrapLines ? (
                <div className="diff-scroll">
                  <div className="diff-rows">
                    <div className="diff-column-labels" aria-hidden="true">
                      <span>{t.original}</span>
                      <span>{t.revised}</span>
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
                    <div className="diff-pane-label">{t.original}</div>
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
                    <div className="diff-pane-label">{t.revised}</div>
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
