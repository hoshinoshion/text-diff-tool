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
  LoaderCircle,
  Moon,
  RotateCcw,
  Sun,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
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
const WHITESPACE_MODES: readonly WhitespaceMode[] = ["none", "amount", "all"];
const NARROW_SCREEN_QUERY = "(max-width: 760px)";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
// Rendering is the slow part for huge results, so rows appear in batches.
const RENDER_BATCH_SIZE = 1_500;
let sessionLocale: Locale | null = null;

const PRESET_TEXTS: Record<Locale, { left: string; right: string }> = {
  en: {
    left: `Lemon Pound Cake

Preheat the oven to 180°C.
Beat 200 g butter with 180 g sugar until pale.
Add 3 eggs, one at a time.
Fold in 200 g flour and the zest of one lemon.
Bake for 45 minutes.`,
    right: `Lemon Pound Cake

Preheat the oven to 175°C.
Beat 200 g soft butter with 160 g sugar until pale and fluffy.
Add 3 eggs, one at a time.
Fold in 200 g flour, a pinch of salt and the zest of two lemons.
Bake for 50 minutes, until a skewer comes out clean.
Let it cool before slicing.`,
  },
  "zh-CN": {
    left: `柠檬磅蛋糕

烤箱预热至 180°C。
将 200 克黄油和 180 克糖打发至颜色变浅。
分三次加入 3 个鸡蛋。
拌入 200 克面粉和一个柠檬的皮屑。
烘烤 45 分钟。`,
    right: `柠檬磅蛋糕

烤箱预热至 175°C。
将 200 克软化黄油和 160 克糖打发至蓬松发白。
分三次加入 3 个鸡蛋。
拌入 200 克面粉、一小撮盐和两个柠檬的皮屑。
烘烤 50 分钟，直到竹签插入后拔出无残留。
放凉后再切片。`,
  },
};

const translations = {
  en: {
    title: "Diff — Compare Two Texts",
    description:
      "Paste two versions of any text and see exactly what changed, line by line and word by word. Runs entirely in your browser.",
    headline: "Compare text",
    privacy: "Your text never leaves this browser.",
    languageLabel: "Language",
    switchToDark: "Use dark theme",
    switchToLight: "Use light theme",
    workspaceLabel: "Compare texts",
    before: "Before",
    after: "After",
    beforePlaceholder: "Paste the earlier version…",
    afterPlaceholder: "Paste the newer version…",
    clearBefore: "Clear the Before side",
    clearAfter: "Clear the After side",
    copyBefore: "Copy the Before text",
    copyAfter: "Copy the After text",
    swap: "Swap Before and After",
    startOver: "Start over",
    whitespace: "Whitespace",
    whitespaceExact: "Exact",
    whitespaceExactTitle: "Every space and tab counts",
    whitespaceAmount: "Ignore changes",
    whitespaceAmountTitle:
      "Treat runs of spaces and tabs as one and ignore trailing spaces, like git diff -b",
    whitespaceAll: "Ignore all",
    whitespaceAllTitle: "Leave spaces and tabs out of the comparison, like git diff -w",
    changes: "Changes",
    changeSummaryLabel: "Change summary",
    changedLineKey: "Changed line",
    changedWordsKey: "Changed words",
    wrapLines: "Wrap lines",
    foldUnchanged: "Hide unchanged",
    foldUnchangedTitle: "Keep only a few lines around each change",
    computing: "Comparing…",
    waiting: "Nothing to compare yet",
    waitingDescription: "Paste text into both sides to see what changed.",
    identical: "No differences",
    identicalDescription: "Both sides match with the current whitespace setting.",
    copyFailure: "Couldn’t copy",
    clipboardPermission:
      "Your browser blocked clipboard access. Select the text and copy it by hand.",
    textCount: (lines: number, characters: number) =>
      `${lines.toLocaleString("en")} ${lines === 1 ? "line" : "lines"} · ${characters.toLocaleString("en")} ${
        characters === 1 ? "char" : "chars"
      }`,
    changedLines: (count: number) =>
      `${count.toLocaleString("en")} ${count === 1 ? "line differs" : "lines differ"}`,
    showFolded: (count: number) =>
      `Show ${count.toLocaleString("en")} unchanged ${count === 1 ? "line" : "lines"}`,
    showMore: (count: number) =>
      `Load more · ${count.toLocaleString("en")} ${count === 1 ? "row" : "rows"} left`,
  },
  "zh-CN": {
    title: "Diff · 文本对比",
    description:
      "粘贴两个版本的文本，逐行、逐词标出改动。全部在浏览器本地完成，内容不会上传。",
    headline: "文本对比",
    privacy: "文本只在你的浏览器里处理，不会上传。",
    languageLabel: "语言",
    switchToDark: "切换到深色",
    switchToLight: "切换到浅色",
    workspaceLabel: "文本对比",
    before: "修改前",
    after: "修改后",
    beforePlaceholder: "粘贴较早的版本…",
    afterPlaceholder: "粘贴较新的版本…",
    clearBefore: "清空修改前",
    clearAfter: "清空修改后",
    copyBefore: "复制修改前的文本",
    copyAfter: "复制修改后的文本",
    swap: "对调前后",
    startOver: "全部清空",
    whitespace: "空白字符",
    whitespaceExact: "严格比较",
    whitespaceExactTitle: "每个空格和制表符都参与比较",
    whitespaceAmount: "忽略数量",
    whitespaceAmountTitle: "连续空白视为一个，并忽略行尾空白（同 git diff -b）",
    whitespaceAll: "全部忽略",
    whitespaceAllTitle: "完全不比较空格和制表符（同 git diff -w）",
    changes: "改动",
    changeSummaryLabel: "改动统计",
    changedLineKey: "改动的行",
    changedWordsKey: "改动的词",
    wrapLines: "自动换行",
    foldUnchanged: "隐藏未改动",
    foldUnchangedTitle: "只保留每处改动附近的几行",
    computing: "对比中…",
    waiting: "还没有内容",
    waitingDescription: "在上方两侧粘贴文本，改动会显示在这里。",
    identical: "没有差异",
    identicalDescription: "在当前空白字符设置下，两侧内容完全相同。",
    copyFailure: "复制失败",
    clipboardPermission: "浏览器未允许访问剪贴板，请手动选中文本复制。",
    textCount: (lines: number, characters: number) =>
      `${lines} 行 · ${characters} 字`,
    changedLines: (count: number) => `${count} 行不同`,
    showFolded: (count: number) => `展开 ${count} 行未改动内容`,
    showMore: (count: number) => `继续加载（剩余 ${count} 行）`,
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
      <ChevronsUpDown size={14} aria-hidden="true" />
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
              <span>{t.before}</span>
              <span>{t.after}</span>
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
                {side === "left" ? t.before : t.after}
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
  const [whitespace, setWhitespace] = useState<WhitespaceMode>("none");
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

  const whitespaceOptions: Record<WhitespaceMode, { label: string; title: string }> = {
    none: { label: t.whitespaceExact, title: t.whitespaceExactTitle },
    amount: { label: t.whitespaceAmount, title: t.whitespaceAmountTitle },
    all: { label: t.whitespaceAll, title: t.whitespaceAllTitle },
  };

  let diffContent;
  if (!result) {
    diffContent = (
      <div className="empty-state">
        <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />
        <strong>{t.computing}</strong>
      </div>
    );
  } else if (rows.length === 0) {
    diffContent = (
      <div className="empty-state">
        <strong>{t.waiting}</strong>
        <p>{t.waitingDescription}</p>
      </div>
    );
  } else if (changedRows === 0) {
    diffContent = (
      <div className="empty-state success-state">
        <span className="empty-icon" aria-hidden="true">
          <Check size={18} strokeWidth={2.5} />
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
      <header className="masthead">
        <div className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            <span />
            <span />
          </span>
          diff
        </div>
        <div className="masthead-actions">
          <div className="language-switch" role="group" aria-label={t.languageLabel}>
            <button
              type="button"
              aria-pressed={locale === "en"}
              onClick={() => selectLanguage("en")}
              lang="en"
            >
              EN
            </button>
            <button
              type="button"
              aria-pressed={locale === "zh-CN"}
              onClick={() => selectLanguage("zh-CN")}
              lang="zh-CN"
            >
              中文
            </button>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? t.switchToLight : t.switchToDark}
            title={theme === "dark" ? t.switchToLight : t.switchToDark}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <div className="page">
        <div className="intro">
          <h1>{t.headline}</h1>
        </div>

        <section className="compare" aria-label={t.workspaceLabel}>
          <div className="sheets">
            <article className="sheet sheet-before">
              <div className="sheet-heading">
                <span className="sheet-label">{t.before}</span>
                <span className="sheet-count">
                  <CountLabel count={result?.leftCount} t={t} />
                </span>
                <span className="sheet-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => copyText("left")}
                    disabled={!leftText}
                    aria-label={t.copyBefore}
                    title={t.copyBefore}
                  >
                    {copied === "left" ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setLeftText("")}
                    disabled={!leftText}
                    aria-label={t.clearBefore}
                    title={t.clearBefore}
                  >
                    <X size={16} />
                  </button>
                </span>
              </div>
              <textarea
                ref={leftEditor}
                style={editorHeight ? { height: `${editorHeight}px` } : undefined}
                value={leftText}
                onChange={(event) => setLeftText(event.target.value)}
                onScroll={(event) => syncEditorScroll(event.currentTarget, rightEditor.current)}
                placeholder={t.beforePlaceholder}
                aria-label={t.before}
                spellCheck={false}
              />
            </article>

            <button
              type="button"
              className="swap-button"
              onClick={swapTexts}
              aria-label={t.swap}
              title={t.swap}
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
            </button>

            <article className="sheet sheet-after">
              <div className="sheet-heading">
                <span className="sheet-label">{t.after}</span>
                <span className="sheet-count">
                  <CountLabel count={result?.rightCount} t={t} />
                </span>
                <span className="sheet-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => copyText("right")}
                    disabled={!rightText}
                    aria-label={t.copyAfter}
                    title={t.copyAfter}
                  >
                    {copied === "right" ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setRightText("")}
                    disabled={!rightText}
                    aria-label={t.clearAfter}
                    title={t.clearAfter}
                  >
                    <X size={16} />
                  </button>
                </span>
              </div>
              <textarea
                ref={rightEditor}
                style={editorHeight ? { height: `${editorHeight}px` } : undefined}
                value={rightText}
                onChange={(event) => setRightText(event.target.value)}
                onScroll={(event) => syncEditorScroll(event.currentTarget, leftEditor.current)}
                placeholder={t.afterPlaceholder}
                aria-label={t.after}
                spellCheck={false}
              />
            </article>
          </div>

          <div className="compare-options">
            <div className="option-group">
              <span className="option-label" id="whitespace-label">
                {t.whitespace}
              </span>
              <div className="segmented" role="group" aria-labelledby="whitespace-label">
                {WHITESPACE_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={whitespace === mode}
                    title={whitespaceOptions[mode].title}
                    onClick={() => setWhitespace(mode)}
                  >
                    {whitespaceOptions[mode].label}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="text-button" onClick={clearTexts}>
              <RotateCcw size={14} aria-hidden="true" />
              {t.startOver}
            </button>
          </div>
        </section>

        <section className="changes" aria-label={t.changes} aria-busy={pending}>
          <div className="changes-heading">
            <div className="changes-title">
              <h2>{t.changes}</h2>
              {changedRows > 0 ? (
                <div className="change-summary" aria-label={t.changeSummaryLabel}>
                  <span className="tally tally-removed">−{result?.removedLines ?? 0}</span>
                  <span className="tally tally-added">+{result?.addedLines ?? 0}</span>
                  <span className="tally-total">{t.changedLines(changedRows)}</span>
                </div>
              ) : null}
              {pending && result ? (
                <span className="changes-pending" role="status">
                  <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                  {t.computing}
                </span>
              ) : null}
            </div>
            <div className="view-options">
              <button
                type="button"
                className="toggle"
                aria-pressed={wrapLines}
                onClick={() => setWrapLines(!wrapLines)}
              >
                <span className="toggle-box" aria-hidden="true">
                  <Check size={11} strokeWidth={3} />
                </span>
                {t.wrapLines}
              </button>
              <button
                type="button"
                className="toggle"
                aria-pressed={foldUnchanged}
                title={t.foldUnchangedTitle}
                onClick={() => {
                  setFoldPreference(!foldUnchanged);
                  setExpandedFolds(new Set());
                }}
              >
                <span className="toggle-box" aria-hidden="true">
                  <Check size={11} strokeWidth={3} />
                </span>
                {t.foldUnchanged}
              </button>
            </div>
          </div>

          <div className="diff-frame">{diffContent}</div>

          {changedRows > 0 ? (
            <div className="legend" aria-hidden="true">
              <span>
                <i className="legend-swatch legend-line" />
                {t.changedLineKey}
              </span>
              <span>
                <i className="legend-swatch legend-words" />
                {t.changedWordsKey}
              </span>
            </div>
          ) : null}
        </section>
      </div>

      <footer className="colophon">
        <p>{t.privacy}</p>
      </footer>
      <Toaster position="bottom-center" richColors theme={theme} />
    </main>
  );
}
