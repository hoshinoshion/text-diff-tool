"use client";

import {
  memo,
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
  ChevronsUpDown,
  Copy,
  Eraser,
  FileDiff,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Sun,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useInitialLocale } from "@/app/locale-provider";
import { useInitialTheme } from "@/app/theme-provider";
import { useDiff } from "@/app/use-diff";
import {
  type DetailedRow,
  type Segment,
  type TextCount,
  type WhitespaceMode,
} from "@/lib/diff";
import {
  AUTO_FOLD_ROW_THRESHOLD,
  buildDisplayItems,
  type DisplayItem,
} from "@/lib/diff-view";
import {
  isLocale,
  LANGUAGE_COOKIE_KEY,
  LANGUAGE_STORAGE_KEY,
  type Locale,
} from "@/lib/locale";
import { THEME_COOKIE_KEY, type Theme } from "@/lib/theme";

const LANGUAGE_CHANGE_EVENT = "text-diff-tool-language-change";
const THEME_CHANGE_EVENT = "text-diff-tool-theme-change";
const NARROW_SCREEN_QUERY = "(max-width: 760px)";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
// Rendering is the slow part for huge results, so rows appear in batches.
const RENDER_BATCH_SIZE = 1_500;
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
    switchToDark: "Switch to dark theme",
    switchToLight: "Switch to light theme",
    workspaceLabel: "Text comparison workspace",
    swap: "Swap sides",
    clear: "Clear",
    ignoreWhitespaceAmount: "Ignore whitespace changes",
    ignoreWhitespaceAmountTitle:
      "Treat runs of spaces and tabs as equal and ignore trailing whitespace",
    ignoreAllWhitespace: "Ignore all whitespace",
    ignoreAllWhitespaceTitle: "Ignore every space, tab, and other whitespace",
    wrapLines: "Wrap lines",
    foldUnchanged: "Collapse unchanged",
    foldUnchangedTitle: "Hide unchanged lines except a few around each change",
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
      "Light colors mark changed lines; darker colors mark the changed words (characters in Chinese)",
    diffStatsLabel: "Diff statistics",
    computing: "Comparing…",
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
    showFolded: (count: number) =>
      `Show ${count} unchanged ${count === 1 ? "line" : "lines"}`,
    showMore: (count: number) =>
      `Show more (${count} ${count === 1 ? "row" : "rows"} remaining)`,
  },
  "zh-CN": {
    title: "文本对比工具",
    description: "在浏览器中并排比较两份文本，高亮显示新增、删除和修改的内容。",
    tagline: "粘贴两份文本，立即看见每一处变化",
    privacy: "仅在当前浏览器中处理",
    languageLabel: "语言",
    switchToDark: "切换到深色模式",
    switchToLight: "切换到浅色模式",
    workspaceLabel: "文本对比工作区",
    swap: "交换两侧",
    clear: "清空",
    ignoreWhitespaceAmount: "忽略空白数量变化",
    ignoreWhitespaceAmountTitle: "连续的空格和制表符视为相同，并忽略行尾空白",
    ignoreAllWhitespace: "忽略所有空白",
    ignoreAllWhitespaceTitle: "忽略所有空格、制表符等空白字符",
    wrapLines: "自动换行",
    foldUnchanged: "折叠未变化的行",
    foldUnchangedTitle: "隐藏未变化的行，只保留每处变化前后的几行",
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
    diffDescription: "浅色标记整行变化，深色标记具体变化的词语（中文按字符）",
    diffStatsLabel: "差异统计",
    computing: "正在对比…",
    waiting: "等待文本",
    waitingDescription: "将需要比较的内容粘贴到上方左右两侧。",
    identical: "两份文本完全一致",
    identicalDescription: "当前设置下没有发现任何差异。",
    copyFailure: "复制失败，请手动选择文本复制。",
    clipboardPermission: "浏览器可能未授予剪贴板权限。",
    textCount: (lines: number, characters: number) =>
      `${lines} 行 · ${characters} 字符`,
    changedLines: (count: number) => `${count} 行差异`,
    showFolded: (count: number) => `显示 ${count} 行未变化的内容`,
    showMore: (count: number) => `显示更多（还有 ${count} 行）`,
  },
} satisfies Record<Locale, Record<string, unknown>>;

type Translation = (typeof translations)[Locale];

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

function getEffectiveTheme(): Theme {
  const chosenTheme = document.documentElement.dataset.theme;
  if (chosenTheme === "light" || chosenTheme === "dark") return chosenTheme;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

function subscribeToTheme(onStoreChange: () => void) {
  const query = window.matchMedia(DARK_SCHEME_QUERY);
  query.addEventListener("change", onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => {
    query.removeEventListener("change", onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

function isNarrowScreen() {
  return window.matchMedia(NARROW_SCREEN_QUERY).matches;
}

function subscribeToScreenWidth(onStoreChange: () => void) {
  const query = window.matchMedia(NARROW_SCREEN_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function TextSegments({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) => (
    <span key={`${segment.kind}-${index}`} className={`token-${segment.kind}`}>
      {segment.text}
    </span>
  ));
}

function LineText({
  text,
  segments,
}: {
  text: string;
  segments: Segment[] | null | undefined;
}) {
  return (
    <code>{segments ? <TextSegments segments={segments} /> : text || " "}</code>
  );
}

function DiffLineCell({ row, side }: { row: DetailedRow; side: "left" | "right" }) {
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
      {line ? (
        <LineText text={line.text} segments={row.segments?.[side]} />
      ) : (
        <code> </code>
      )}
    </div>
  );
}

function FoldButton({
  item,
  label,
  onExpand,
}: {
  item: Extract<DisplayItem, { type: "fold" }>;
  label: string;
  onExpand: (key: string) => void;
}) {
  return (
    <button type="button" className="diff-fold" onClick={() => onExpand(item.key)}>
      <ChevronsUpDown size={13} aria-hidden="true" />
      {label}
    </button>
  );
}

function UnifiedLine({
  kind,
  leftNumber,
  rightNumber,
  text,
  segments,
}: {
  kind: "same" | "removed" | "added";
  leftNumber: number | null;
  rightNumber: number | null;
  text: string;
  segments: Segment[] | null | undefined;
}) {
  return (
    <div className={`unified-line unified-line-${kind}`}>
      <span className="line-number">{leftNumber ?? ""}</span>
      <span className="line-number">{rightNumber ?? ""}</span>
      <span className="line-marker" aria-hidden="true">
        {kind === "removed" ? "−" : kind === "added" ? "+" : ""}
      </span>
      <LineText text={text} segments={segments} />
    </div>
  );
}

function UnifiedRow({ row }: { row: DetailedRow }) {
  if (row.kind === "same") {
    return (
      <UnifiedLine
        kind="same"
        leftNumber={row.left?.number ?? null}
        rightNumber={row.right?.number ?? null}
        text={row.right?.text ?? row.left?.text ?? ""}
        segments={null}
      />
    );
  }

  return (
    <>
      {row.left ? (
        <UnifiedLine
          kind="removed"
          leftNumber={row.left.number}
          rightNumber={null}
          text={row.left.text}
          segments={row.segments?.left}
        />
      ) : null}
      {row.right ? (
        <UnifiedLine
          kind="added"
          leftNumber={null}
          rightNumber={row.right.number}
          text={row.right.text}
          segments={row.segments?.right}
        />
      ) : null}
    </>
  );
}

function itemKey(item: DisplayItem) {
  return item.type === "row" ? `row-${item.index}` : `fold-${item.key}`;
}

const DiffTable = memo(function DiffTable({
  rows,
  items,
  hiddenItemCount,
  wrapLines,
  unified,
  t,
  onExpandFold,
  onShowMore,
}: {
  rows: DetailedRow[];
  items: DisplayItem[];
  hiddenItemCount: number;
  wrapLines: boolean;
  unified: boolean;
  t: Translation;
  onExpandFold: (key: string) => void;
  onShowMore: () => void;
}) {
  const leftDiffPane = useRef<HTMLDivElement>(null);
  const rightDiffPane = useRef<HTMLDivElement>(null);
  const syncingDiffScroll = useRef(false);

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

  const foldButton = (item: Extract<DisplayItem, { type: "fold" }>) => (
    <FoldButton
      item={item}
      label={t.showFolded(item.end - item.start)}
      onExpand={onExpandFold}
    />
  );

  const showMore =
    hiddenItemCount > 0 ? (
      <button type="button" className="diff-show-more" onClick={onShowMore}>
        {t.showMore(hiddenItemCount)}
      </button>
    ) : null;

  const wrapClass = wrapLines ? "wrap-lines" : "no-wrap-lines";

  if (unified) {
    return (
      <div className={`diff-table unified-view ${wrapClass}`}>
        <div className="unified-scroll">
          <div className="unified-content">
            {items.map((item) =>
              item.type === "row" ? (
                <UnifiedRow key={itemKey(item)} row={rows[item.index]} />
              ) : (
                <div className="unified-fold" key={itemKey(item)}>
                  {foldButton(item)}
                </div>
              ),
            )}
          </div>
        </div>
        {showMore}
      </div>
    );
  }

  return (
    <div className={`diff-table ${wrapClass}`}>
      {wrapLines ? (
        <div className="diff-scroll">
          <div className="diff-rows">
            <div className="diff-column-labels" aria-hidden="true">
              <span>{t.original}</span>
              <span>{t.revised}</span>
            </div>
            {items.map((item) =>
              item.type === "row" ? (
                <div
                  className={`diff-row diff-row-${rows[item.index].kind}`}
                  key={itemKey(item)}
                >
                  <DiffLineCell row={rows[item.index]} side="left" />
                  <DiffLineCell row={rows[item.index]} side="right" />
                </div>
              ) : (
                <div className="diff-fold-row" key={itemKey(item)}>
                  {foldButton(item)}
                </div>
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="parallel-diff">
          {(["left", "right"] as const).map((side) => (
            <div className="diff-pane-group" key={side}>
              <div className="diff-pane-label">
                {side === "left" ? t.original : t.revised}
              </div>
              <div
                className="diff-pane"
                ref={side === "left" ? leftDiffPane : rightDiffPane}
                onScroll={(event) =>
                  syncDiffScroll(
                    event.currentTarget,
                    side === "left" ? rightDiffPane.current : leftDiffPane.current,
                  )
                }
              >
                <div className="diff-pane-content">
                  {items.map((item) =>
                    item.type === "row" ? (
                      <div
                        className={`diff-pane-row diff-row-${rows[item.index].kind}`}
                        key={itemKey(item)}
                      >
                        <DiffLineCell row={rows[item.index]} side={side} />
                      </div>
                    ) : (
                      <div className="diff-fold-row" key={itemKey(item)}>
                        {foldButton(item)}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showMore}
    </div>
  );
});

function CountLabel({ count, t }: { count: TextCount | undefined; t: Translation }) {
  return <span>{count ? t.textCount(count.lines, count.characters) : "…"}</span>;
}

export default function Home() {
  const initialLocale = useInitialLocale();
  const initialTheme = useInitialTheme();
  const getServerLocale = useCallback(() => initialLocale, [initialLocale]);
  const getServerTheme = useCallback(
    () => initialTheme ?? "light",
    [initialTheme],
  );
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getPreferredLocale,
    getServerLocale,
  );
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getEffectiveTheme,
    getServerTheme,
  );
  const narrowScreen = useSyncExternalStore(
    subscribeToScreenWidth,
    isNarrowScreen,
    () => false,
  );
  const [editedTexts, setEditedTexts] = useState<{
    left: string;
    right: string;
  } | null>(null);
  const [ignoreWhitespaceAmount, setIgnoreWhitespaceAmount] = useState(false);
  const [ignoreAllWhitespace, setIgnoreAllWhitespace] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  const [foldPreference, setFoldPreference] = useState<boolean | null>(null);
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH_SIZE);
  const [copied, setCopied] = useState<"left" | "right" | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const preferredEditorHeight = useRef<number | null>(null);
  const resizingViewport = useRef(false);
  const leftEditor = useRef<HTMLTextAreaElement>(null);
  const rightEditor = useRef<HTMLTextAreaElement>(null);
  const t = translations[locale];
  const { left: leftText, right: rightText } = editedTexts ?? PRESET_TEXTS[locale];
  const whitespace: WhitespaceMode = ignoreAllWhitespace
    ? "all"
    : ignoreWhitespaceAmount
      ? "amount"
      : "none";

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

  const { result, pending } = useDiff(leftText, rightText, whitespace);
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const foldUnchanged = foldPreference ?? rows.length > AUTO_FOLD_ROW_THRESHOLD;
  const displayItems = useMemo(
    () => buildDisplayItems(rows, foldUnchanged, expandedFolds),
    [rows, foldUnchanged, expandedFolds],
  );
  const visibleItems = useMemo(
    () => displayItems.slice(0, renderLimit),
    [displayItems, renderLimit],
  );
  const changedRows = result?.changedRows ?? 0;

  const expandFold = useCallback((key: string) => {
    setExpandedFolds((current) => new Set(current).add(key));
  }, []);

  const showMoreRows = useCallback(() => {
    setRenderLimit((current) => current + RENDER_BATCH_SIZE);
  }, []);

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

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.cookie = `${THEME_COOKIE_KEY}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
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
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1200);
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

  let diffContent;
  if (!result) {
    diffContent = (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">
          <LoaderCircle size={24} className="animate-spin" />
        </span>
        <strong>{t.computing}</strong>
      </div>
    );
  } else if (rows.length === 0) {
    diffContent = (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">
          <FileDiff size={24} />
        </span>
        <strong>{t.waiting}</strong>
        <p>{t.waitingDescription}</p>
      </div>
    );
  } else if (changedRows === 0) {
    diffContent = (
      <div className="empty-state success-state">
        <span className="empty-icon" aria-hidden="true">
          <Check size={24} />
        </span>
        <strong>{t.identical}</strong>
        <p>{t.identicalDescription}</p>
      </div>
    );
  } else {
    diffContent = (
      <DiffTable
        rows={rows}
        items={visibleItems}
        hiddenItemCount={displayItems.length - visibleItems.length}
        wrapLines={wrapLines}
        unified={narrowScreen}
        t={t}
        onExpandFold={expandFold}
        onShowMore={showMoreRows}
      />
    );
  }

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
          <button
            type="button"
            className="icon-button theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? t.switchToLight : t.switchToDark}
            title={theme === "dark" ? t.switchToLight : t.switchToDark}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
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
            <label
              className="switch-option"
              title={t.ignoreWhitespaceAmountTitle}
            >
              <Switch
                checked={ignoreWhitespaceAmount || ignoreAllWhitespace}
                disabled={ignoreAllWhitespace}
                onCheckedChange={setIgnoreWhitespaceAmount}
                aria-label={t.ignoreWhitespaceAmount}
              />
              {t.ignoreWhitespaceAmount}
            </label>
            <label className="switch-option" title={t.ignoreAllWhitespaceTitle}>
              <Switch
                checked={ignoreAllWhitespace}
                onCheckedChange={setIgnoreAllWhitespace}
                aria-label={t.ignoreAllWhitespace}
              />
              {t.ignoreAllWhitespace}
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
                <CountLabel count={result?.leftCount} t={t} />
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
                <CountLabel count={result?.rightCount} t={t} />
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

        <section className="diff-card" aria-label={t.diffResult} aria-busy={pending}>
          <div className="diff-heading">
            <div>
              <div className="diff-title-row">
                <h2>{t.diffResult}</h2>
                {pending && result ? (
                  <span className="diff-pending" role="status">
                    <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                    {t.computing}
                  </span>
                ) : null}
              </div>
              <p>{t.diffDescription}</p>
            </div>
            <div className="diff-heading-side">
              <div className="diff-view-options">
                <label className="switch-option">
                  <Switch
                    checked={wrapLines}
                    onCheckedChange={setWrapLines}
                    aria-label={t.wrapLines}
                  />
                  {t.wrapLines}
                </label>
                <label className="switch-option" title={t.foldUnchangedTitle}>
                  <Switch
                    checked={foldUnchanged}
                    onCheckedChange={(checked) => {
                      setFoldPreference(checked);
                      setExpandedFolds(new Set());
                    }}
                    aria-label={t.foldUnchanged}
                  />
                  {t.foldUnchanged}
                </label>
              </div>
              <div className="diff-stats" aria-label={t.diffStatsLabel}>
                <span className="stat stat-removed">− {result?.removedLines ?? 0}</span>
                <span className="stat stat-added">+ {result?.addedLines ?? 0}</span>
                <span className="stat stat-total">{t.changedLines(changedRows)}</span>
              </div>
            </div>
          </div>

          {diffContent}
        </section>
      </section>
      <Toaster position="bottom-center" richColors theme={theme} />
    </main>
  );
}
