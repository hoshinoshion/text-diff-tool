import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: { port: 24679 } },
});

after(async () => {
  await vite.close();
});

const { buildRows, countText, inlineDiff, splitGraphemes } =
  await vite.ssrLoadModule("/lib/diff.ts");

function changedRows(rows) {
  return rows.filter((row) => row.kind === "changed");
}

function reconstruct(rows, side) {
  return rows
    .filter((row) => row[side])
    .map((row) => row[side].text)
    .join("\n");
}

function changedText(segments, kind) {
  return segments
    .filter((segment) => segment.kind === kind)
    .map((segment) => segment.text)
    .join("");
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function exactLcsLength(left, right) {
  const table = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? table[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(
              table[leftIndex + 1][rightIndex],
              table[leftIndex][rightIndex + 1],
            );
    }
  }

  return table[0][0];
}

function normalizedGraphemes(text) {
  return splitGraphemes(text).map((part) => part.normalize("NFC"));
}

function sameGraphemeCount(segments) {
  return segments
    .filter((segment) => segment.kind === "same")
    .reduce((count, segment) => count + splitGraphemes(segment.text).length, 0);
}

function recordId(text) {
  return text.match(/^record-(\d+)/)?.[1] ?? null;
}

test("keeps a single insertion aligned in documents above the old size limit", () => {
  const leftLines = Array.from(
    { length: 600 },
    (_, index) => `line-${String(index + 1).padStart(4, "0")}`,
  );
  const rightLines = leftLines.slice();
  rightLines.splice(1, 0, "INSERTED");

  const rows = buildRows(leftLines.join("\n"), rightLines.join("\n"), false);
  const changes = changedRows(rows);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].left, null);
  assert.deepEqual(changes[0].right, { number: 2, text: "INSERTED" });
  assert.equal(reconstruct(rows, "left"), leftLines.join("\n"));
  assert.equal(reconstruct(rows, "right"), rightLines.join("\n"));
});

test("aligns multiple distant edits in a large document", () => {
  const leftLines = Array.from(
    { length: 900 },
    (_, index) => `record-${String(index + 1).padStart(4, "0")}`,
  );
  const rightLines = leftLines.slice();
  rightLines[199] = "record-0200-updated";
  rightLines.splice(450, 0, "record-inserted");
  rightLines.splice(701, 1);

  const leftText = leftLines.join("\n");
  const rightText = rightLines.join("\n");
  const rows = buildRows(leftText, rightText, false);
  const changes = changedRows(rows);

  assert.equal(changes.filter((row) => row.left).length, 2);
  assert.equal(changes.filter((row) => row.right).length, 2);
  assert.equal(reconstruct(rows, "left"), leftText);
  assert.equal(reconstruct(rows, "right"), rightText);
});

test("aligns an insertion when every line changes beyond the full-matrix limit", () => {
  const leftLines = Array.from(
    { length: 600 },
    (_, index) => `record-${String(index).padStart(4, "0")} | 状态：旧值`,
  );
  const rightLines = leftLines.map((line) => line.replace("旧值", "新值"));
  rightLines.unshift("inserted-heading | 这是新增标题");

  const rows = buildRows(leftLines.join("\n"), rightLines.join("\n"), false);

  assert.equal(rows.length, 601);
  assert.equal(rows[0].left, null);
  assert.equal(rows[0].right.text, "inserted-heading | 这是新增标题");
  for (let index = 0; index < leftLines.length; index += 1) {
    assert.equal(rows[index + 1].left.text, leftLines[index]);
    assert.equal(rows[index + 1].right.text, rightLines[index + 1]);
  }
});

test("preserves both original lines when whitespace is ignored", () => {
  const rows = buildRows(
    "alpha    beta\n\t缩进\n旧值",
    "alpha beta\n  缩进\n新值",
    true,
  );

  assert.equal(rows[0].kind, "same");
  assert.equal(rows[0].left.text, "alpha    beta");
  assert.equal(rows[0].right.text, "alpha beta");
  assert.equal(rows[1].left.text, "\t缩进");
  assert.equal(rows[1].right.text, "  缩进");
  assert.equal(changedRows(rows).length, 1);
});

test("reconstructs both sides when repeated lines surround a change", () => {
  const leftText = "header\nrepeat\nold\nrepeat\ntail";
  const rightText = "header\nrepeat\nnew\nrepeat\ntail";
  const rows = buildRows(leftText, rightText, false);

  assert.equal(changedRows(rows).length, 1);
  assert.equal(reconstruct(rows, "left"), leftText);
  assert.equal(reconstruct(rows, "right"), rightText);
});

test("keeps an inserted line separate from the partially changed line after it", () => {
  const rows = buildRows(
    "标题\n订单金额：100 元\n结尾",
    "标题\n新增说明：以下金额已复核\n订单金额：101 元\n结尾",
    false,
  );
  const changes = changedRows(rows);

  assert.equal(changes.length, 2);
  assert.equal(changes[0].left, null);
  assert.equal(changes[0].right.text, "新增说明：以下金额已复核");
  assert.equal(changes[1].left.text, "订单金额：100 元");
  assert.equal(changes[1].right.text, "订单金额：101 元");
});

test("keeps a deleted line separate from the partially changed line after it", () => {
  const rows = buildRows(
    "标题\n已废弃的临时说明\n当前状态：已启用\n结尾",
    "标题\n当前状态：已停用\n结尾",
    false,
  );
  const changes = changedRows(rows);

  assert.equal(changes.length, 2);
  assert.equal(changes[0].left.text, "已废弃的临时说明");
  assert.equal(changes[0].right, null);
  assert.equal(changes[1].left.text, "当前状态：已启用");
  assert.equal(changes[1].right.text, "当前状态：已停用");
});

test("aligns several partially changed lines around an insertion", () => {
  const rows = buildRows(
    "开始\nAlpha version 10 is enabled\nBeta version 10 is enabled\n结束",
    "开始\nAlpha version 11 is enabled\nNEW AUDIT NOTE\nBeta version 11 is enabled\n结束",
    false,
  );
  const changes = changedRows(rows);

  assert.equal(changes.length, 3);
  assert.equal(changes[0].left.text, "Alpha version 10 is enabled");
  assert.equal(changes[0].right.text, "Alpha version 11 is enabled");
  assert.equal(changes[1].left, null);
  assert.equal(changes[1].right.text, "NEW AUDIT NOTE");
  assert.equal(changes[2].left.text, "Beta version 10 is enabled");
  assert.equal(changes[2].right.text, "Beta version 11 is enabled");
});

test("keeps a newly inserted blank line aligned in the preset comparison", () => {
  const leftText = `文本对比工具可以帮助你快速发现两份内容之间的区别。
它会逐行分析文本，并用颜色标记被删除或修改的部分。
所有内容都在浏览器本地处理，不会上传到服务器。

将第一份文本粘贴到左侧，然后在右侧粘贴新版本。`;
  const rightText = `文本对比工具可以帮助你快速找出两份内容之间的差异。

它会逐行分析文本，并用颜色清晰标记被新增、删除或修改的部分。
所有内容都只在浏览器本地处理，不会上传到任何服务器。

将原始文本粘贴到左侧，然后在右侧粘贴修改后的版本。
差异结果会实时更新。`;
  const rows = buildRows(leftText, rightText, false);

  assert.equal(rows[0].left.text, leftText.split("\n")[0]);
  assert.equal(rows[0].right.text, rightText.split("\n")[0]);
  assert.equal(rows[1].left, null);
  assert.equal(rows[1].right.text, "");
  assert.equal(rows[2].left.text, leftText.split("\n")[1]);
  assert.equal(rows[2].right.text, rightText.split("\n")[2]);
  assert.equal(rows[4].kind, "same");
  assert.equal(rows[4].left.text, "");
  assert.equal(rows[4].right.text, "");
  assert.equal(reconstruct(rows, "left"), leftText);
  assert.equal(reconstruct(rows, "right"), rightText);

  const swappedRows = buildRows(rightText, leftText, false);
  assert.equal(swappedRows[1].left.text, "");
  assert.equal(swappedRows[1].right, null);
  assert.equal(swappedRows[2].left.text, rightText.split("\n")[2]);
  assert.equal(swappedRows[2].right.text, leftText.split("\n")[1]);
  assert.equal(reconstruct(swappedRows, "left"), rightText);
  assert.equal(reconstruct(swappedRows, "right"), leftText);
});

test("normalizes equivalent Unicode while preserving original spelling", () => {
  const leftText = "café\n开发者👩‍💻";
  const rightText = "cafe\u0301\n开发者👩‍💻";
  const rows = buildRows(leftText, rightText, false);

  assert.equal(changedRows(rows).length, 0);
  assert.equal(rows[0].left.text, "café");
  assert.equal(rows[0].right.text, "cafe\u0301");
  assert.equal(splitGraphemes("👩‍💻").length, 1);

  const segments = inlineDiff("版本👩‍💻一", "版本👩‍💻二");
  assert.equal(changedText(segments.left, "removed"), "一");
  assert.equal(changedText(segments.right, "added"), "二");
});

test("keeps blank lines and trailing newlines aligned", () => {
  const leftText = "第一行\n\n第三行\n";
  const rightText = "第一行\n新增内容\n第三行\n";
  const rows = buildRows(leftText, rightText, false);
  const changes = changedRows(rows);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].left.text, "");
  assert.equal(changes[0].right.text, "新增内容");
  assert.equal(rows.at(-1).left.text, "");
  assert.equal(rows.at(-1).right.text, "");
  assert.equal(reconstruct(rows, "left"), leftText);
  assert.equal(reconstruct(rows, "right"), rightText);
});

test("highlights only one changed character in an extreme unbroken line", () => {
  const leftText = `prefix_${"a".repeat(600)}a${"a".repeat(599)}_suffix`;
  const rightText = `prefix_${"a".repeat(600)}b${"a".repeat(599)}_suffix`;
  const segments = inlineDiff(leftText, rightText);

  assert.equal(changedText(segments.left, "removed"), "a");
  assert.equal(changedText(segments.right, "added"), "b");
  assert.equal(segments.left.map((segment) => segment.text).join(""), leftText);
  assert.equal(segments.right.map((segment) => segment.text).join(""), rightText);
});

test("keeps several distant changes precise in an extreme unbroken line", () => {
  const leftText = `${"a".repeat(800)}X${"a".repeat(900)}Y${"a".repeat(800)}`;
  const rightText = `${"a".repeat(800)}Q${"a".repeat(900)}Z${"a".repeat(800)}`;
  const segments = inlineDiff(leftText, rightText);

  assert.equal(changedText(segments.left, "removed"), "XY");
  assert.equal(changedText(segments.right, "added"), "QZ");
  assert.equal(segments.left.map((segment) => segment.text).join(""), leftText);
  assert.equal(segments.right.map((segment) => segment.text).join(""), rightText);
});

test("preserves a large common block between distant insertions in one long line", () => {
  const leftText = `${"a".repeat(1_000)}${"B".repeat(600)}${"c".repeat(1_000)}`;
  const rightText = `${"a".repeat(1_000)}${"X".repeat(300)}${"B".repeat(600)}${"Y".repeat(300)}${"c".repeat(1_000)}`;
  const segments = inlineDiff(leftText, rightText);

  assert.equal(changedText(segments.left, "removed"), "");
  assert.equal(
    changedText(segments.right, "added"),
    `${"X".repeat(300)}${"Y".repeat(300)}`,
  );
  assert.equal(segments.left.map((segment) => segment.text).join(""), leftText);
  assert.equal(segments.right.map((segment) => segment.text).join(""), rightText);
});

test("aligns sparse changes in a huge repetition-heavy document", () => {
  const leftLines = Array.from(
    { length: 1_200 },
    (_, index) => (index % 2 === 0 ? "repeat-a" : "repeat-b"),
  );
  const rightLines = leftLines.slice();
  rightLines[150] = "changed-near-start";
  rightLines[1_000] = "changed-near-end";

  const leftText = leftLines.join("\n");
  const rightText = rightLines.join("\n");
  const rows = buildRows(leftText, rightText, false);
  const changes = changedRows(rows);

  assert.equal(changes.length, 2);
  assert.equal(reconstruct(rows, "left"), leftText);
  assert.equal(reconstruct(rows, "right"), rightText);
});

test("aligns insertion and deletion in a huge repetition-heavy document", () => {
  const leftLines = Array.from(
    { length: 1_200 },
    (_, index) => (index % 3 === 0 ? "repeat-a" : "repeat-b"),
  );
  const rightLines = leftLines.slice();
  rightLines.splice(200, 0, "inserted-marker");
  rightLines.splice(1_000, 1);

  const leftText = leftLines.join("\n");
  const rightText = rightLines.join("\n");
  const rows = buildRows(leftText, rightText, false);
  const changes = changedRows(rows);

  assert.equal(changes.filter((row) => row.left).length, 1);
  assert.equal(changes.filter((row) => row.right).length, 1);
  assert.equal(reconstruct(rows, "left"), leftText);
  assert.equal(reconstruct(rows, "right"), rightText);
});

test("counts user-perceived characters instead of UTF-16 code units", () => {
  assert.deepEqual(countText("A👩‍💻\n"), { lines: 2, characters: 3 });
  assert.deepEqual(countText(""), { lines: 0, characters: 0 });
});

test("normalizes Windows and classic Mac line endings", () => {
  const rows = buildRows("a\r\nb\rc", "a\nb\nc", false);
  assert.equal(changedRows(rows).length, 0);
  assert.deepEqual(
    rows.map((row) => row.left.text),
    ["a", "b", "c"],
  );
});

test("fuzzes random line insertions, deletions, edits, and Unicode content", () => {
  const values = ["甲", "乙", "emoji👩‍💻", "café", "空 格", "tab\tvalue"];

  for (let seed = 1; seed <= 200; seed += 1) {
    const random = createRandom(seed);
    const count = 12 + Math.floor(random() * 56);
    const leftLines = Array.from({ length: count }, (_, index) => {
      const id = String(index).padStart(4, "0");
      return `record-${id} | ${values[Math.floor(random() * values.length)]} | v1`;
    });
    const retainedIds = new Set();
    const rightLines = [];
    let insertionNumber = 0;

    for (let index = 0; index < leftLines.length; index += 1) {
      if (random() < 0.12) {
        rightLines.push(
          `insert-${seed}-${insertionNumber} | ${values[Math.floor(random() * values.length)]}`,
        );
        insertionNumber += 1;
      }

      if (random() < 0.12) continue;

      const id = recordId(leftLines[index]);
      retainedIds.add(id);
      rightLines.push(
        random() < 0.55
          ? leftLines[index].replace("| v1", `| v2-${seed}-${index}`)
          : leftLines[index],
      );
    }

    if (random() < 0.5) {
      rightLines.push(`insert-${seed}-${insertionNumber} | 尾部新增`);
    }

    const leftText = leftLines.join("\n");
    const rightText = rightLines.join("\n");
    const rows = buildRows(leftText, rightText, false);

    assert.equal(reconstruct(rows, "left"), leftText, `left seed ${seed}`);
    assert.equal(reconstruct(rows, "right"), rightText, `right seed ${seed}`);

    for (const row of rows) {
      if (row.right?.text.startsWith("insert-")) {
        if (row.left) {
          assert.equal(
            retainedIds.has(recordId(row.left.text)),
            false,
            `insert seed ${seed}`,
          );
        }
      } else if (row.left && row.right) {
        assert.equal(
          recordId(row.left.text),
          recordId(row.right.text),
          `paired seed ${seed}`,
        );
      } else if (row.left) {
        assert.equal(
          retainedIds.has(recordId(row.left.text)),
          false,
          `removed seed ${seed}`,
        );
      }
    }
  }
});

test("fuzzes inline diffs against an exact grapheme LCS", () => {
  const alphabet = ["a", "b", "中", "文", "🙂", "👩‍💻", "é", "e\u0301", " "];

  for (let seed = 1; seed <= 240; seed += 1) {
    const random = createRandom(seed * 17);
    const leftLength = 4 + Math.floor(random() * 28);
    const rightLength = 4 + Math.floor(random() * 28);
    const makeText = (length) =>
      Array.from(
        { length },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join("");
    const leftText = makeText(leftLength);
    const rightText = makeText(rightLength);
    const segments = inlineDiff(leftText, rightText);
    const expectedLcs = exactLcsLength(
      normalizedGraphemes(leftText),
      normalizedGraphemes(rightText),
    );

    assert.equal(
      segments.left.map((segment) => segment.text).join(""),
      leftText,
      `left seed ${seed}`,
    );
    assert.equal(
      segments.right.map((segment) => segment.text).join(""),
      rightText,
      `right seed ${seed}`,
    );
    assert.equal(sameGraphemeCount(segments.left), expectedLcs, `LCS seed ${seed}`);
    assert.equal(
      sameGraphemeCount(segments.right),
      expectedLcs,
      `right LCS seed ${seed}`,
    );
  }
});

test("fuzzes the bounded inline path with long edited strings", () => {
  const alphabet = ["a", "b", "c", "中", "🙂"];

  for (let seed = 1; seed <= 20; seed += 1) {
    const random = createRandom(seed * 101);
    const left = Array.from(
      { length: 420 },
      () => alphabet[Math.floor(random() * alphabet.length)],
    );
    const right = left.slice();

    for (let edit = 0; edit < 36; edit += 1) {
      const index = Math.floor(random() * right.length);
      if (random() < 0.34 && right.length > 1) {
        right.splice(index, 1);
      } else if (random() < 0.5) {
        right.splice(index, 0, alphabet[Math.floor(random() * alphabet.length)]);
      } else {
        right[index] = alphabet[Math.floor(random() * alphabet.length)];
      }
    }

    const leftText = left.join("");
    const rightText = right.join("");
    const segments = inlineDiff(leftText, rightText);
    const expectedLcs = exactLcsLength(left, right);

    assert.equal(segments.left.map((segment) => segment.text).join(""), leftText);
    assert.equal(segments.right.map((segment) => segment.text).join(""), rightText);
    assert.equal(sameGraphemeCount(segments.left), expectedLcs, `long seed ${seed}`);
    assert.equal(sameGraphemeCount(segments.right), expectedLcs, `long right seed ${seed}`);
  }
});
