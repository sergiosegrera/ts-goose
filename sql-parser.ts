import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MigrationDirection } from "./migration";

/**
 * Goose-compatible SQL parser (TypeScript).
 * - Same public API and return shape as your original.
 * - Handles semicolons inside strings/identifiers/dollar-quoted bodies/comments.
 * - Supports goose annotations (case-insensitive):
 *   Up, Down, StatementBegin, StatementEnd, NO TRANSACTION, ENVSUB ON/OFF.
 * - Preserves your behavior for files without Up/Down markers.
 * - Keeps inputs & outputs the same.
 */

export const UP_COMMENT = "-- +goose Up";
export const DOWN_COMMENT = "-- +goose Down";
export const NO_TRANSACTION_COMMENT = "-- +goose NO TRANSACTION";

enum ParserState {
  NORMAL = "NORMAL",
  IN_BLOCK = "IN_BLOCK",
}

interface ParseResult {
  statements: string[];
  transaction: boolean;
}

const ANN_LINE_RE = /^--\s*\+goose\s+(.+?)\s*$/i; // strict " -- +goose <...> "
type Ann =
  | "UP"
  | "DOWN"
  | "STATEMENTBEGIN"
  | "STATEMENTEND"
  | "NO TRANSACTION"
  | "ENVSUB ON"
  | "ENVSUB OFF";

function parseAnnotation(line: string): Ann | null {
  const m = ANN_LINE_RE.exec(line);
  if (!m || !m[1]) return null;
  const cmd = m[1].trim().toUpperCase();
  switch (cmd) {
    case "UP":
    case "DOWN":
    case "STATEMENTBEGIN":
    case "STATEMENTEND":
    case "NO TRANSACTION":
    case "ENVSUB ON":
    case "ENVSUB OFF":
      return cmd as Ann;
    default:
      return null;
  }
}

function isGooseAnn(line: string, ann: string): boolean {
  // Accept both "-- +goose X" and "--+goose X" (back-compat)
  const trimmed = line.trim();
  return (
    new RegExp(`^--\\s*\\+goose\\s+${ann}$`, "i").test(trimmed) ||
    new RegExp(`^--\\+goose\\s+${ann}$`, "i").test(trimmed)
  );
}

function startsWithNoTxDirective(s: string): boolean {
  const firstNonEmpty = s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (
    firstNonEmpty === NO_TRANSACTION_COMMENT ||
    firstNonEmpty === "--+goose NO TRANSACTION"
  );
}

function ensureTrailingSemicolon(statement: string): string {
  const t = statement.trim();
  return t.endsWith(";") ? t : `${t};`;
}

function isCommentOnly(statement: string): boolean {
  // Treat block comments and line comments as ignorable.
  // If any non-comment, non-whitespace remains, it's not comment-only.
  const s = statement
    .replace(/\/\*[\s\S]*?\*\//g, "") // strip /* ... */
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^--/.test(l));
  return s.length === 0;
}

function interpolateEnv(line: string, envOn: boolean): string {
  if (!envOn) return line;
  // Very small ${VAR} expander. Avoids $VAR (too risky).
  return line.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => {
    const v = process.env[k];
    return v ?? "";
  });
}

/**
 * Extract UP section from migration content (goose-like).
 * If both Up/Down exist, Up must appear before Down.
 */
export function extractUpSection(
  fileContent: string,
  upComment: string = UP_COMMENT,
  downComment: string = DOWN_COMMENT,
): string {
  validateMigrationFile(fileContent, upComment, downComment);
  const upIdx = fileContent.search(
    new RegExp(`^${escapeRe(upComment)}\\s*$`, "m"),
  );
  let content = fileContent.slice(upIdx + upComment.length).trim();
  const downIdx = content.search(
    new RegExp(`^${escapeRe(downComment)}\\s*$`, "m"),
  );
  if (downIdx !== -1) content = content.slice(0, downIdx).trim();
  return content;
}

/**
 * Extract DOWN section from migration content (goose-like).
 */
export function extractDownSection(
  fileContent: string,
  downComment: string = DOWN_COMMENT,
  upComment: string = UP_COMMENT,
): string {
  validateMigrationFile(fileContent, upComment, downComment);
  const downIdx = fileContent.search(
    new RegExp(`^${escapeRe(downComment)}\\s*$`, "m"),
  );
  if (downIdx === -1) {
    throw new Error(
      "DOWN section not found. Missing '-- +goose Down' comment.",
    );
  }
  return fileContent.slice(downIdx + downComment.length).trim();
}

/**
 * Validate basic goose migration structure:
 * - Exactly one Up (case-insensitive) and at most one Down.
 * - If both present, Up must precede Down.
 * (Compatible with your existing behavior.)
 */
export function validateMigrationFile(
  fileContent: string,
  upComment: string = "-- +goose Up",
  downComment: string = "-- +goose Down",
): void {
  const upRe = new RegExp(`^${escapeRe(upComment)}\\s*$`, "gim");
  const downRe = new RegExp(`^${escapeRe(downComment)}\\s*$`, "gim");

  const upMatches = fileContent.match(upRe) || [];
  if (upMatches.length === 0) {
    throw new Error(
      `Migration file must have exactly one '${upComment}' annotation. Found 0.`,
    );
  }
  if (upMatches.length > 1) {
    throw new Error(
      `Migration file must have exactly one '${upComment}' annotation. Found ${upMatches.length}.`,
    );
  }

  const downMatches = fileContent.match(downRe) || [];
  if (downMatches.length > 1) {
    throw new Error(
      `Migration file can have at most one '${downComment}' annotation. Found ${downMatches.length}.`,
    );
  }

  if (downMatches.length === 1) {
    const upIdx = fileContent.search(
      new RegExp(`^${escapeRe(upComment)}\\s*$`, "im"),
    );
    const downIdx = fileContent.search(
      new RegExp(`^${escapeRe(downComment)}\\s*$`, "im"),
    );
    if (downIdx < upIdx) {
      throw new Error(
        `'${upComment}' must come before '${downComment}' in migration file.`,
      );
    }
  }
}

/**
 * Public API: parse a file on disk.
 */
export async function parseSQLFile(
  direction: MigrationDirection,
  folder: string,
  version: { version_id: bigint; file_name: string },
): Promise<ParseResult> {
  const file_content = await readFile(
    path.join(folder, version.file_name),
    "utf8",
  );
  return parseSqlStatements(file_content, direction);
}

/**
 * Core parser. Same signature as before.
 * - If Up/Down markers exist, only parse that section.
 * - Honors NO TRANSACTION (top-of-section/file).
 * - Supports StatementBegin/End blocks.
 * - Splits by semicolons using a safe tokenizer.
 */
export function parseSqlStatements(
  content: string,
  direction: MigrationDirection = "up",
): ParseResult {
  // NO TRANSACTION must be at the very top of the file (before Up/Down markers)
  // and applies to BOTH up and down migrations
  const transaction = !startsWithNoTxDirective(content);
  let envOn = false;

  const hasUp = /(^|\n)--\s*\+goose\s+up\s*$/im.test(content);
  const hasDown = /(^|\n)--\s*\+goose\s+down\s*$/im.test(content);

  let section = content;
  if (hasUp || hasDown) {
    if (direction === "up")
      section = extractUpSection(content, UP_COMMENT, DOWN_COMMENT);
    else if (direction === "down")
      section = extractDownSection(content, DOWN_COMMENT, UP_COMMENT);
    else throw new Error(`Invalid direction: ${direction}`);
  }

  const statements: string[] = [];
  let state: ParserState = ParserState.NORMAL;
  let buf = "";
  let haveBegunStatement = false; // once true, we preserve inline comments until statement ends

  const lines = section.split("\n");
  const flushIfNonEmpty = (forceSemi = true) => {
    const stmt = buf.trim();
    if (stmt && !isCommentOnly(stmt)) {
      statements.push(forceSemi ? ensureTrailingSemicolon(stmt) : stmt);
    }
    buf = "";
    haveBegunStatement = false;
  };

  // Tokenizer flags for safe semicolon detection
  let inSQ = false; // single-quoted string
  let inDQ = false; // double-quoted identifier
  let inLine = false; // -- comment (until \n)
  let inBlock = false; // /* ... */
  let dollarTag: string | null = null; // $tag$ ... $tag$

  const resetLineComment = () => {
    inLine = false;
  };

  function maybeEndStatementOnSemicolon(ch: string): boolean {
    if (ch !== ";") return false;
    if (inSQ || inDQ || inLine || inBlock || dollarTag !== null) return false;
    // Only split on semicolon in NORMAL mode (not in a StatementBegin block)
    if (state !== ParserState.NORMAL) return false;
    return true;
  }

  function scanLine(s: string): void {
    // Handle annotations on their own line (and toggle state/features)
    const trim = s.trim();
    const ann = parseAnnotation(trim);

    if (!haveBegunStatement && (trim === "" || trim.startsWith("--"))) {
      // Leading comments/empties before a statement are ignored unless they're annotations.
      if (ann) {
        switch (ann) {
          case "NO TRANSACTION":
            // NO TRANSACTION is already checked at file level, skip the directive line
            return;
          case "ENVSUB ON":
            envOn = true;
            return;
          case "ENVSUB OFF":
            envOn = false;
            return;
          case "STATEMENTBEGIN":
            if (state === ParserState.IN_BLOCK) {
              throw new Error(
                "Nested StatementBegin found. Blocks cannot be nested.",
              );
            }
            state = ParserState.IN_BLOCK;
            return;
          case "STATEMENTEND":
            if (state !== ParserState.IN_BLOCK) {
              throw new Error(
                "'-- +goose StatementEnd' without matching StatementBegin.",
              );
            }
            // End of a block-statement: flush accumulated buf as a single stmt.
            flushIfNonEmpty(true);
            state = ParserState.NORMAL;
            return;
          // Up/Down annotations inside already extracted section are ignored.
          default:
            return;
        }
      }
      // Non-annotation comment or empty line before statement => skip
      if (!ann) return;
    }

    // If the line IS an annotation that toggles env or state and we're already inside a statement,
    // we *exclude* the annotation text from the SQL buffer (goose doesn't include it).
    if (ann) {
      switch (ann) {
        case "NO TRANSACTION":
          // NO TRANSACTION is already checked at file level, skip the directive line
          return;
        case "ENVSUB ON":
          envOn = true;
          return;
        case "ENVSUB OFF":
          envOn = false;
          return;
        case "STATEMENTBEGIN":
          if (state === ParserState.IN_BLOCK) {
            throw new Error(
              "Nested StatementBegin found. Blocks cannot be nested.",
            );
          }
          // flush any partial simple statement before entering a block
          if (buf.trim()) flushIfNonEmpty(true);
          state = ParserState.IN_BLOCK;
          return;
        case "STATEMENTEND":
          if (state !== ParserState.IN_BLOCK) {
            throw new Error(
              "'-- +goose StatementEnd' without matching StatementBegin.",
            );
          }
          flushIfNonEmpty(true);
          state = ParserState.NORMAL;
          return;
        default:
          // Up/Down inside section – ignore
          return;
      }
    }

    // Apply env interpolation if enabled
    const line = interpolateEnv(s, envOn);

    // Once a statement begins, we preserve comments until it ends (like goose).
    // Append the line as we scan—it lets StatementBegin blocks capture raw bodies.
    haveBegunStatement = true;

    if (state === ParserState.IN_BLOCK) {
      buf += `${line}\n`;
      return;
    }

    // NORMAL state: scan char-by-char to split on safe semicolons
    let i = 0;
    while (i < line.length) {
      const ch = line[i] ?? "";
      const next = i + 1 < line.length ? (line[i + 1] ?? "") : "";

      // Enter/exit line comments
      if (
        !inSQ &&
        !inDQ &&
        !inBlock &&
        dollarTag === null &&
        ch === "-" &&
        next === "-"
      ) {
        inLine = true;
      }

      // Enter/exit block comments (/* ... */) – non-nestable
      if (
        !inSQ &&
        !inDQ &&
        !inLine &&
        dollarTag === null &&
        ch === "/" &&
        next === "*"
      ) {
        inBlock = true;
      } else if (inBlock && ch === "*" && next === "/") {
        inBlock = false;
        buf += "*/";
        i += 2;
        continue;
      }

      // Dollar-quoted strings: $tag$ ... $tag$
      if (!inSQ && !inDQ && !inLine && !inBlock) {
        if (dollarTag === null && ch === "$") {
          // capture $[tag]$
          const m = /^\$([A-Za-z0-9_]*)\$/u.exec(line.slice(i));
          if (m) {
            dollarTag = m[1] ?? ""; // may be ""
            const open = `$${dollarTag}$`;
            buf += open;
            i += open.length;
            continue;
          }
        } else if (dollarTag !== null && ch === "$") {
          const maybe = `$${dollarTag}$`;
          if (line.slice(i, i + maybe.length) === maybe) {
            buf += maybe;
            i += maybe.length;
            dollarTag = null;
            continue;
          }
        }
      }

      // Double-quoted identifier
      if (!inSQ && !inLine && !inBlock && dollarTag === null) {
        if (!inDQ && ch === '"') {
          inDQ = true;
        } else if (inDQ && ch === '"') {
          // escaped "" => stay inside if doubled
          if (next === '"') {
            buf += '""';
            i += 2;
            continue;
          }
          inDQ = false;
        }
      }

      // Single-quoted string
      if (!inDQ && !inLine && !inBlock && dollarTag === null) {
        if (!inSQ && ch === "'") {
          inSQ = true;
        } else if (inSQ && ch === "'") {
          // doubled '' => escape
          if (next === "'") {
            buf += "''";
            i += 2;
            continue;
          }
          inSQ = false;
        }
      }

      // If we hit a safe semicolon, end the statement
      if (maybeEndStatementOnSemicolon(ch)) {
        buf += ch;
        // If there's a trailing comment on this line, we still include it (goose looks at words only for ;)
        // but the statement is considered done now.
        statements.push(ensureTrailingSemicolon(buf.trim()));
        buf = "";
        haveBegunStatement = false;
        // everything after ; belongs to next statement => continue scanning
        i++;
        continue;
      }

      buf += ch;
      i++;
    }

    // End of line resets line-comment state
    resetLineComment();
    buf += "\n";
  }

  for (const line of lines) scanLine(line);

  // End-of-file: unclosed block?
  const finalState = state as ParserState;
  if (finalState === ParserState.IN_BLOCK) {
    throw new Error(
      "Unclosed StatementBegin block. Missing -- +goose StatementEnd.",
    );
  }

  // Flush any remaining buffered content (keep your previous behavior: append ; if needed)
  if (buf.trim() && !isCommentOnly(buf)) {
    statements.push(ensureTrailingSemicolon(buf));
  }

  // Remove NO TRANSACTION/ENVSUB directives if they got into statement buffers accidentally
  const filtered = statements
    .map((s) =>
      s
        .split("\n")
        .filter(
          (ln) =>
            !isGooseAnn(ln, "NO TRANSACTION") &&
            !isGooseAnn(ln, "ENVSUB ON") &&
            !isGooseAnn(ln, "ENVSUB OFF") &&
            !isGooseAnn(ln, "STATEMENTBEGIN") &&
            !isGooseAnn(ln, "STATEMENTEND"),
        )
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);

  return { statements: filtered, transaction };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
