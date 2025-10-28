/**
 * SQL Parser with state machine support for complex statements
 * Handles PL/pgSQL blocks annotated with -- +goose StatementBegin/StatementEnd
 */

export const UP_COMMENT = "-- +goose Up";
export const DOWN_COMMENT = "-- +goose Down";

enum ParserState {
	NORMAL = "NORMAL",
	IN_BLOCK = "IN_BLOCK",
}

interface ParseResult {
	statements: string[];
}

/**
 * Parse SQL content into individual statements.
 * Supports:
 * - Simple statements separated by semicolons
 * - Complex statements (e.g., PL/pgSQL) wrapped in -- +goose StatementBegin/StatementEnd
 */
export function parseSqlStatements(content: string): ParseResult {
	const lines = content.split("\n");
	const statements: string[] = [];
	let currentStatement: string[] = [];
	let state: ParserState = ParserState.NORMAL;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const trimmedLine = line.trim();

		// Check for StatementBegin marker
		if (
			trimmedLine === "-- +goose StatementBegin" ||
			trimmedLine === "--+goose StatementBegin"
		) {
			if (state === ParserState.IN_BLOCK) {
				throw new Error(
					`Nested StatementBegin found at line ${i + 1}. StatementBegin/StatementEnd blocks cannot be nested.`,
				);
			}

			// Before entering block, flush any pending statement
			if (currentStatement.length > 0) {
				const stmt = currentStatement.join("\n").trim();
				if (stmt && !isCommentOnly(stmt)) {
					statements.push(stmt);
				}
				currentStatement = [];
			}

			state = ParserState.IN_BLOCK;
			continue; // Don't include the marker in the statement
		}

		// Check for StatementEnd marker
		if (
			trimmedLine === "-- +goose StatementEnd" ||
			trimmedLine === "--+goose StatementEnd"
		) {
			if (state !== ParserState.IN_BLOCK) {
				throw new Error(
					`StatementEnd found at line ${i + 1} without matching StatementBegin.`,
				);
			}

			// Flush the block statement
			const stmt = currentStatement.join("\n").trim();
			if (stmt && !isCommentOnly(stmt)) {
				statements.push(stmt);
			}
			currentStatement = [];
			state = ParserState.NORMAL;
			continue; // Don't include the marker in the statement
		}

		// Handle content based on current state
		if (state === ParserState.IN_BLOCK) {
			// Inside a block, collect all lines (including those with semicolons)
			currentStatement.push(line);
		} else {
			// Normal state: split by semicolons
			// But we need to handle lines that might have multiple statements
			const segments = splitBySemicolon(line);

			for (let j = 0; j < segments.length; j++) {
				const segment = segments[j];
				if (segment === undefined) continue;

				if (j < segments.length - 1) {
					// This segment ended with a semicolon
					currentStatement.push(segment);
					const stmt = currentStatement.join("\n").trim();
					if (stmt && !isCommentOnly(stmt)) {
						// Add back the semicolon
						statements.push(ensureTrailingSemicolon(stmt));
					}
					currentStatement = [];
				} else {
					// Last segment (no semicolon yet, or end of line)
					if (segment.trim()) {
						currentStatement.push(segment);
					}
				}
			}
		}
	}

	// Check for unclosed block
	if (state === ParserState.IN_BLOCK) {
		throw new Error(
			"Unclosed StatementBegin block. Missing -- +goose StatementEnd.",
		);
	}

	// Flush any remaining statement
	if (currentStatement.length > 0) {
		const stmt = currentStatement.join("\n").trim();
		if (stmt && !isCommentOnly(stmt)) {
			statements.push(ensureTrailingSemicolon(stmt));
		}
	}

	return { statements };
}

/**
 * Split a line by semicolons, but preserve them in the segments.
 * Returns segments where each (except possibly the last) represents a complete statement.
 */
function splitBySemicolon(line: string): string[] {
	// Simple split for now - can be enhanced to handle string literals
	const parts = line.split(";");
	const segments: string[] = [];

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === undefined) continue;

		if (i < parts.length - 1) {
			// Add semicolon back to all but the last part
			segments.push(part + ";");
		} else {
			// Last part (after the last semicolon, or no semicolon)
			segments.push(part);
		}
	}

	return segments;
}

/**
 * Check if a statement is only comments (no actual SQL)
 */
function isCommentOnly(statement: string): boolean {
	const lines = statement.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		// If there's a non-empty line that doesn't start with --, it's not comment-only
		if (trimmed && !trimmed.startsWith("--")) {
			return false;
		}
	}
	return true;
}

/**
 * Ensure a statement ends with a semicolon
 */
function ensureTrailingSemicolon(statement: string): string {
	const trimmed = statement.trim();
	if (!trimmed.endsWith(";")) {
		return trimmed + ";";
	}
	return trimmed;
}

/**
 * Validate migration file structure
 */
export function validateMigrationFile(
	fileContent: string,
	upComment: string = "-- +goose Up",
	downComment: string = "-- +goose Down",
): void {
	// Check for exactly one UP annotation
	const upMatches = fileContent.match(
		new RegExp(upComment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
	);
	if (!upMatches || upMatches.length === 0) {
		throw new Error(
			`Migration file must have exactly one '${upComment}' annotation. Found 0.`,
		);
	}
	if (upMatches.length > 1) {
		throw new Error(
			`Migration file must have exactly one '${upComment}' annotation. Found ${upMatches.length}.`,
		);
	}

	// Check for at most one DOWN annotation
	const downMatches = fileContent.match(
		new RegExp(downComment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
	);
	if (downMatches && downMatches.length > 1) {
		throw new Error(
			`Migration file can have at most one '${downComment}' annotation. Found ${downMatches.length}.`,
		);
	}

	// If both exist, UP must come before DOWN
	if (downMatches && downMatches.length === 1) {
		const upIndex = fileContent.indexOf(upComment);
		const downIndex = fileContent.indexOf(downComment);
		if (downIndex < upIndex) {
			throw new Error(
				`'${upComment}' must come before '${downComment}' in migration file.`,
			);
		}
	}
}

/**
 * Extract UP section from migration file content
 */
export function extractUpSection(
	fileContent: string,
	upComment: string = UP_COMMENT,
	downComment: string = DOWN_COMMENT,
): string {
	// Validate file structure first
	validateMigrationFile(fileContent, upComment, downComment);

	const upIndex = fileContent.indexOf(upComment);
	// We already validated this exists, so no need to check again

	let content = fileContent.substring(upIndex + upComment.length).trim();

	// Remove everything after DOWN comment if it exists
	const downIndex = content.indexOf(downComment);
	if (downIndex !== -1) {
		content = content.substring(0, downIndex).trim();
	}

	return content;
}

/**
 * Extract DOWN section from migration file content
 */
export function extractDownSection(
	fileContent: string,
	downComment: string = DOWN_COMMENT,
	upComment: string = UP_COMMENT,
): string {
	// Validate file structure first
	validateMigrationFile(fileContent, upComment, downComment);

	const downIndex = fileContent.indexOf(downComment);
	if (downIndex === -1) {
		throw new Error(
			"DOWN section not found. Missing '-- +goose Down' comment.",
		);
	}

	return fileContent.substring(downIndex + downComment.length).trim();
}
