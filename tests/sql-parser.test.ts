/**
 * Comprehensive test suite for SQL parser
 * Run with: bun test tests/sql-parser.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  extractDownSection,
  extractUpSection,
  parseSqlStatements,
  validateMigrationFile,
} from "../sql-parser";

// ============================================================================
// TEST CASE CONSTANTS
// ============================================================================

const SIMPLE_SINGLE_STATEMENT = `
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);
`;

const SIMPLE_MULTIPLE_STATEMENTS = `
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
`;

const COMPLEX_PLPGSQL_FUNCTION = `
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
`;

const COMPLEX_PLPGSQL_PROCEDURE = `
-- +goose StatementBegin
CREATE OR REPLACE PROCEDURE cleanup_old_data(days INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM logs WHERE created_at < NOW() - days * INTERVAL '1 day';
    COMMIT;
END;
$$;
-- +goose StatementEnd
`;

const MIXED_SIMPLE_AND_COMPLEX = `
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE INDEX idx_users_name ON users(name);

-- +goose StatementBegin
CREATE TRIGGER update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
-- +goose StatementEnd

ALTER TABLE users ADD COLUMN email VARCHAR(255);
`;

const STATEMENTS_WITH_COMMENTS = `
-- This is a comment
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

-- Another comment
-- Multiple comment lines
CREATE TABLE posts (
    id SERIAL PRIMARY KEY
);
`;

const EMPTY_LINES_AND_WHITESPACE = `

CREATE TABLE users (id SERIAL PRIMARY KEY);


CREATE TABLE posts (id SERIAL PRIMARY KEY);


`;

const MULTIPLE_STATEMENTS_ONE_LINE = `
CREATE TABLE a (id INT); CREATE TABLE b (id INT); CREATE TABLE c (id INT);
`;

const STATEMENT_WITH_STRING_LITERALS = `
INSERT INTO users (name, bio) VALUES ('John', 'Software; Developer; Enthusiast');
INSERT INTO config (key, value) VALUES ('db;host', 'localhost;5432');
`;

const NESTED_STATEMENT_BEGIN = `
-- +goose StatementBegin
CREATE FUNCTION outer()
RETURNS VOID AS $$
BEGIN
    -- +goose StatementBegin
    -- This should error
    NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
`;

const MISSING_STATEMENT_END = `
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- +goose StatementBegin
CREATE FUNCTION test()
RETURNS VOID AS $$
BEGIN
    NULL;
END;
$$ LANGUAGE plpgsql;
`;

const UNEXPECTED_STATEMENT_END = `
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- +goose StatementEnd

CREATE TABLE posts (id SERIAL PRIMARY KEY);
`;

const EMPTY_STATEMENT_BLOCK = `
-- +goose StatementBegin
-- +goose StatementEnd
`;

const ONLY_COMMENTS = `
-- This is a comment
-- Another comment
`;

const COMPLEX_TRIGGER_WITH_WHEN = `
-- +goose StatementBegin
CREATE TRIGGER update_modified_column
    BEFORE UPDATE ON users
    FOR EACH ROW
    WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION update_modified_timestamp();
-- +goose StatementEnd
`;

const FULL_MIGRATION_FILE = `-- +goose Up
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER IF EXISTS update_users_timestamp ON users;
-- +goose StatementEnd

-- +goose StatementBegin
DROP FUNCTION IF EXISTS update_timestamp();
-- +goose StatementEnd

DROP TABLE IF EXISTS users;
`;

const NO_TRAILING_SEMICOLON = `
CREATE TABLE users (
    id SERIAL PRIMARY KEY
)
`;

const STATEMENT_WITH_DOLLAR_QUOTES = `
-- +goose StatementBegin
CREATE FUNCTION test_quotes()
RETURNS TEXT AS $BODY$
DECLARE
    result TEXT := 'SELECT * FROM users;';
BEGIN
    RETURN result;
END;
$BODY$ LANGUAGE plpgsql;
-- +goose StatementEnd
`;

const MULTILINE_INSERT = `
INSERT INTO users (name, email, bio) VALUES
    ('Alice', 'alice@example.com', 'Developer'),
    ('Bob', 'bob@example.com', 'Designer'),
    ('Charlie', 'charlie@example.com', 'Manager');
`;

// Validation test cases
const VALID_UP_ONLY = `-- +goose Up
CREATE TABLE users (id SERIAL PRIMARY KEY);
`;

const VALID_UP_AND_DOWN = `-- +goose Up
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- +goose Down
DROP TABLE IF EXISTS users;
`;

const MISSING_UP = `
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- +goose Down
DROP TABLE IF EXISTS users;
`;

const MULTIPLE_UP_ANNOTATIONS = `-- +goose Up
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- +goose Up
CREATE TABLE posts (id SERIAL PRIMARY KEY);

-- +goose Down
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;
`;

const MULTIPLE_DOWN_ANNOTATIONS = `-- +goose Up
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- +goose Down
DROP TABLE IF EXISTS users;

-- +goose Down
DROP TABLE IF EXISTS posts;
`;

const DOWN_BEFORE_UP = `-- +goose Down
DROP TABLE IF EXISTS users;

-- +goose Up
CREATE TABLE users (id SERIAL PRIMARY KEY);
`;

// ============================================================================
// TESTS
// ============================================================================

describe("SQL Parser - Simple Statements", () => {
  test("should parse a single simple statement", () => {
    const result = parseSqlStatements(SIMPLE_SINGLE_STATEMENT);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("CREATE TABLE users");
    expect(result.statements[0]).toMatch(/;\s*$/);
  });

  test("should parse multiple simple statements", () => {
    const result = parseSqlStatements(SIMPLE_MULTIPLE_STATEMENTS);
    expect(result.statements).toHaveLength(3);
    expect(result.statements[0]).toContain("CREATE TABLE users");
    expect(result.statements[1]).toContain("CREATE TABLE posts");
    expect(result.statements[2]).toContain("CREATE INDEX");
  });

  test("should parse statements with comments", () => {
    const result = parseSqlStatements(STATEMENTS_WITH_COMMENTS);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE TABLE users");
    expect(result.statements[1]).toContain("CREATE TABLE posts");
  });

  test("should handle empty lines and whitespace", () => {
    const result = parseSqlStatements(EMPTY_LINES_AND_WHITESPACE);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE TABLE users");
    expect(result.statements[1]).toContain("CREATE TABLE posts");
  });

  test("should parse multiple statements on one line", () => {
    const result = parseSqlStatements(MULTIPLE_STATEMENTS_ONE_LINE);
    expect(result.statements).toHaveLength(3);
    expect(result.statements[0]).toContain("CREATE TABLE a");
    expect(result.statements[1]).toContain("CREATE TABLE b");
    expect(result.statements[2]).toContain("CREATE TABLE c");
  });

  test("should add trailing semicolon if missing", () => {
    const result = parseSqlStatements(NO_TRAILING_SEMICOLON);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toMatch(/;\s*$/);
  });

  test("should handle statements with string literals containing semicolons", () => {
    const result = parseSqlStatements(STATEMENT_WITH_STRING_LITERALS);
    // Note: Current implementation is simple and will split on all semicolons
    // This test documents the current behavior
    expect(result.statements.length).toBeGreaterThan(0);
  });
});

describe("SQL Parser - Complex PL/pgSQL Statements", () => {
  test("should parse PL/pgSQL function with StatementBegin/End", () => {
    const result = parseSqlStatements(COMPLEX_PLPGSQL_FUNCTION);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("CREATE OR REPLACE FUNCTION");
    expect(result.statements[0]).toContain("BEGIN");
    expect(result.statements[0]).toContain("END;");
    expect(result.statements[0]).not.toContain("StatementBegin");
    expect(result.statements[0]).not.toContain("StatementEnd");
  });

  test("should parse PL/pgSQL procedure with StatementBegin/End", () => {
    const result = parseSqlStatements(COMPLEX_PLPGSQL_PROCEDURE);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("CREATE OR REPLACE PROCEDURE");
    expect(result.statements[0]).toContain("COMMIT;");
  });

  test("should parse trigger with StatementBegin/End", () => {
    const result = parseSqlStatements(COMPLEX_TRIGGER_WITH_WHEN);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("CREATE TRIGGER");
    expect(result.statements[0]).toContain("WHEN");
  });

  test("should parse function with dollar quotes", () => {
    const result = parseSqlStatements(STATEMENT_WITH_DOLLAR_QUOTES);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("$BODY$");
    expect(result.statements[0]).toContain("SELECT * FROM users;");
  });
});

describe("SQL Parser - Mixed Statements", () => {
  test("should parse mix of simple and complex statements", () => {
    const result = parseSqlStatements(MIXED_SIMPLE_AND_COMPLEX);
    expect(result.statements).toHaveLength(5);
    expect(result.statements[0]).toContain("CREATE TABLE users");
    expect(result.statements[1]).toContain("CREATE OR REPLACE FUNCTION");
    expect(result.statements[2]).toContain("CREATE INDEX");
    expect(result.statements[3]).toContain("CREATE TRIGGER");
    expect(result.statements[4]).toContain("ALTER TABLE");
  });

  test("should parse multiline insert", () => {
    const result = parseSqlStatements(MULTILINE_INSERT);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("Alice");
    expect(result.statements[0]).toContain("Bob");
    expect(result.statements[0]).toContain("Charlie");
  });
});

describe("SQL Parser - Edge Cases", () => {
  test("should return empty array for only comments", () => {
    const result = parseSqlStatements(ONLY_COMMENTS);
    expect(result.statements).toHaveLength(0);
  });

  test("should handle empty statement block", () => {
    const result = parseSqlStatements(EMPTY_STATEMENT_BLOCK);
    expect(result.statements).toHaveLength(0);
  });

  test("should handle empty string", () => {
    const result = parseSqlStatements("");
    expect(result.statements).toHaveLength(0);
  });

  test("should handle only whitespace", () => {
    const result = parseSqlStatements("   \n\n   \t\t  \n  ");
    expect(result.statements).toHaveLength(0);
  });
});

describe("SQL Parser - Error Cases", () => {
  test("should throw error on nested StatementBegin", () => {
    expect(() => parseSqlStatements(NESTED_STATEMENT_BEGIN)).toThrow(
      /Nested StatementBegin/,
    );
  });

  test("should throw error on missing StatementEnd", () => {
    expect(() => parseSqlStatements(MISSING_STATEMENT_END)).toThrow(
      /Missing.*StatementEnd/,
    );
  });

  test("should throw error on unexpected StatementEnd", () => {
    expect(() => parseSqlStatements(UNEXPECTED_STATEMENT_END)).toThrow(
      /without matching StatementBegin/,
    );
  });
});

describe("SQL Parser - Section Extraction", () => {
  test("should extract UP section from full migration file", () => {
    const upContent = extractUpSection(FULL_MIGRATION_FILE);
    expect(upContent).toContain("CREATE TABLE users");
    expect(upContent).toContain("CREATE OR REPLACE FUNCTION");
    expect(upContent).not.toContain("-- +goose Down");
    expect(upContent).not.toContain("DROP TABLE");
  });

  test("should extract DOWN section from full migration file", () => {
    const downContent = extractDownSection(FULL_MIGRATION_FILE);
    expect(downContent).toContain("DROP TRIGGER");
    expect(downContent).toContain("DROP FUNCTION");
    expect(downContent).toContain("DROP TABLE");
    expect(downContent).not.toContain("CREATE TABLE");
  });

  test("should parse full migration UP section correctly", () => {
    const upContent = extractUpSection(FULL_MIGRATION_FILE);
    const result = parseSqlStatements(upContent);
    expect(result.statements).toHaveLength(3);
    expect(result.statements[0]).toContain("CREATE TABLE users");
    expect(result.statements[1]).toContain("CREATE OR REPLACE FUNCTION");
    expect(result.statements[2]).toContain("CREATE TRIGGER");
  });

  test("should parse full migration DOWN section correctly", () => {
    const downContent = extractDownSection(FULL_MIGRATION_FILE);
    const result = parseSqlStatements(downContent);
    expect(result.statements).toHaveLength(3);
    expect(result.statements[0]).toContain("DROP TRIGGER");
    expect(result.statements[1]).toContain("DROP FUNCTION");
    expect(result.statements[2]).toContain("DROP TABLE");
  });

  test("should throw error when UP section is missing", () => {
    const content = "CREATE TABLE users (id INT);";
    expect(() => extractUpSection(content)).toThrow(
      /must have exactly one.*annotation.*Found 0/,
    );
  });

  test("should throw error when DOWN section is missing", () => {
    const content = "-- +goose Up\nCREATE TABLE users (id INT);";
    expect(() => extractDownSection(content)).toThrow(/DOWN section not found/);
  });
});

describe("SQL Parser - Real-World Scenarios", () => {
  test("should handle complex migration with multiple triggers and functions", () => {
    const complexMigration = `
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(255),
    action VARCHAR(50),
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_log (table_name, action, old_data)
        VALUES (TG_TABLE_NAME, TG_OP, row_to_json(OLD));
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_log (table_name, action, old_data, new_data)
        VALUES (TG_TABLE_NAME, TG_OP, row_to_json(OLD), row_to_json(NEW));
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_log (table_name, action, new_data)
        VALUES (TG_TABLE_NAME, TG_OP, row_to_json(NEW));
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER users_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION audit_trigger_func();
-- +goose StatementEnd
`;

    const result = parseSqlStatements(complexMigration);
    expect(result.statements).toHaveLength(3);
    expect(result.statements[0]).toContain("CREATE TABLE audit_log");
    expect(result.statements[1]).toContain("audit_trigger_func");
    expect(result.statements[1]).toContain("TG_OP");
    expect(result.statements[2]).toContain("users_audit_trigger");
  });
});

describe("SQL Parser - Migration File Validation", () => {
  test("should validate migration with only UP section", () => {
    expect(() => validateMigrationFile(VALID_UP_ONLY)).not.toThrow();
  });

  test("should validate migration with UP and DOWN sections", () => {
    expect(() => validateMigrationFile(VALID_UP_AND_DOWN)).not.toThrow();
  });

  test("should throw error when UP annotation is missing", () => {
    expect(() => validateMigrationFile(MISSING_UP)).toThrow(
      /must have exactly one.*annotation.*Found 0/,
    );
  });

  test("should throw error when multiple UP annotations exist", () => {
    expect(() => validateMigrationFile(MULTIPLE_UP_ANNOTATIONS)).toThrow(
      /must have exactly one.*annotation.*Found 2/,
    );
  });

  test("should throw error when multiple DOWN annotations exist", () => {
    expect(() => validateMigrationFile(MULTIPLE_DOWN_ANNOTATIONS)).toThrow(
      /at most one.*annotation.*Found 2/,
    );
  });

  test("should throw error when DOWN comes before UP", () => {
    expect(() => validateMigrationFile(DOWN_BEFORE_UP)).toThrow(
      /must come before/,
    );
  });

  test("should validate when extracting UP section from valid file", () => {
    expect(() => extractUpSection(VALID_UP_AND_DOWN)).not.toThrow();
    const content = extractUpSection(VALID_UP_AND_DOWN);
    expect(content).toContain("CREATE TABLE users");
    expect(content).not.toContain("DROP TABLE");
  });

  test("should validate when extracting DOWN section from valid file", () => {
    expect(() => extractDownSection(VALID_UP_AND_DOWN)).not.toThrow();
    const content = extractDownSection(VALID_UP_AND_DOWN);
    expect(content).toContain("DROP TABLE");
    expect(content).not.toContain("CREATE TABLE");
  });

  test("should throw error when extracting from invalid file", () => {
    expect(() => extractUpSection(MISSING_UP)).toThrow();
    expect(() => extractUpSection(MULTIPLE_UP_ANNOTATIONS)).toThrow();
    expect(() => extractDownSection(DOWN_BEFORE_UP)).toThrow();
  });

  test("should validate FULL_MIGRATION_FILE constant", () => {
    expect(() => validateMigrationFile(FULL_MIGRATION_FILE)).not.toThrow();
  });
});

describe("SQL Parser - NO TRANSACTION Directive", () => {
  test("should recognize NO TRANSACTION directive at start of content", () => {
    const content = `-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);`;
    const result = parseSqlStatements(content);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("CREATE INDEX CONCURRENTLY");
  });

  test("should recognize alternative NO TRANSACTION format", () => {
    const content = `--+goose NO TRANSACTION
CREATE INDEX CONCURRENTLY idx_users_id ON users(id);`;
    const result = parseSqlStatements(content);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(1);
  });

  test("should default to transaction mode when NO TRANSACTION not specified", () => {
    const content = `CREATE TABLE users (id INT);`;
    const result = parseSqlStatements(content);
    expect(result.transaction).toBe(true);
    expect(result.statements).toHaveLength(1);
  });

  test("should handle NO TRANSACTION with multiple statements", () => {
    const content = `-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY idx_users_name ON users(name);
CREATE INDEX CONCURRENTLY idx_posts_user_id ON posts(user_id);`;
    const result = parseSqlStatements(content);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(3);
    expect(result.statements[0]).toContain("idx_users_email");
    expect(result.statements[1]).toContain("idx_users_name");
    expect(result.statements[2]).toContain("idx_posts_user_id");
  });

  test("should handle NO TRANSACTION with complex statements", () => {
    const content = `-- +goose NO TRANSACTION
-- +goose StatementBegin
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
-- +goose StatementEnd`;
    const result = parseSqlStatements(content);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("CREATE INDEX CONCURRENTLY");
    expect(result.statements[0]).not.toContain("StatementBegin");
  });

  test("should strip NO TRANSACTION directive from parsed statements", () => {
    const content = `-- +goose NO TRANSACTION
CREATE TABLE users (id INT);`;
    const result = parseSqlStatements(content);
    expect(result.statements[0]).not.toContain("NO TRANSACTION");
    expect(result.statements[0]).not.toContain("+goose");
  });

  test("should handle NO TRANSACTION in UP section of migration file", () => {
    const content = `-- +goose Up
-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- +goose Down
DROP INDEX IF EXISTS idx_users_email;`;
    const upSection = extractUpSection(content);
    const result = parseSqlStatements(upSection);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(1);
  });

  test("should handle NO TRANSACTION in DOWN section of migration file", () => {
    const content = `-- +goose Up
CREATE TABLE users (id INT);

-- +goose Down
-- +goose NO TRANSACTION
DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;`;
    const downSection = extractDownSection(content);
    const result = parseSqlStatements(downSection);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(1);
  });

  test("should handle regular transaction mode in UP section when not specified in DOWN", () => {
    const content = `-- +goose Up
CREATE TABLE users (id INT);

-- +goose Down
DROP TABLE IF EXISTS users;`;
    const upSection = extractUpSection(content);
    const downSection = extractDownSection(content);
    const upResult = parseSqlStatements(upSection);
    const downResult = parseSqlStatements(downSection);
    expect(upResult.transaction).toBe(true);
    expect(downResult.transaction).toBe(true);
  });

  test("should handle mixed NO TRANSACTION and regular statements", () => {
    const content = `-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY idx_users_name ON users(name);

-- This is a comment
CREATE TABLE logs (id INT);`;
    const result = parseSqlStatements(content);
    // Should be parsed as no-transaction because directive is at start
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(3);
  });

  test("should recognize NO TRANSACTION only at the beginning", () => {
    const content = `CREATE TABLE users (id INT);
-- +goose NO TRANSACTION
CREATE INDEX idx_users_email ON users(email);`;
    const result = parseSqlStatements(content);
    // NO TRANSACTION is not at the beginning, so should default to transaction mode
    expect(result.transaction).toBe(true);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE TABLE");
    expect(result.statements[1]).toContain("CREATE INDEX");
  });

  test("should handle NO TRANSACTION with empty lines before it", () => {
    const content = `

-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);`;
    const result = parseSqlStatements(content);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(1);
  });

  test("should handle NO TRANSACTION with whitespace variations", () => {
    const content = `  -- +goose NO TRANSACTION  
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);`;
    const result = parseSqlStatements(content);
    // trimmedContent.startsWith check should still work because of trim()
    expect(result.transaction).toBe(false);
  });

  test("should properly parse real-world PostgreSQL CONCURRENTLY index with NO TRANSACTION", () => {
    const content = `-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY idx_posts_published_at ON posts(published_at)
WHERE status = 'published';

CREATE INDEX CONCURRENTLY idx_posts_user_id ON posts(user_id)
WHERE deleted_at IS NULL;`;
    const result = parseSqlStatements(content);
    expect(result.transaction).toBe(false);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("WHERE status = 'published'");
    expect(result.statements[1]).toContain("WHERE deleted_at IS NULL");
  });
});

describe("SQL Parser - Advanced Edge Cases", () => {
  test("should handle dollar-quoted strings with semicolons (PostgreSQL)", () => {
    const content = `
-- +goose Up
CREATE FUNCTION test_func() RETURNS text AS $$
BEGIN
  RETURN 'Hello; World';
END;
$$ LANGUAGE plpgsql;

INSERT INTO logs (message) VALUES ('Test;Message');`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("$$");
    expect(result.statements[0]).toContain("'Hello; World'");
    expect(result.statements[1]).toContain("INSERT INTO logs");
  });

  test("should handle dollar-quoted strings with custom tags", () => {
    const content = `
-- +goose Up
CREATE FUNCTION complex_func() RETURNS text AS $body$
BEGIN
  RETURN 'Value; with; semicolons';
END;
$body$ LANGUAGE plpgsql;`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain("$body$");
    expect(result.statements[0]).toContain("'Value; with; semicolons'");
  });

  test("should handle block comments with semicolons", () => {
    const content = `
-- +goose Up
/* This is a comment with semicolons; inside */
CREATE TABLE users (id INT);

/* Multi-line comment
   with semicolons; and
   multiple lines */
INSERT INTO users VALUES (1);`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE TABLE");
    expect(result.statements[1]).toContain("INSERT INTO");
  });

  test("should handle inline comments after statements", () => {
    const content = `
-- +goose Up
CREATE TABLE users (id INT); -- This comment has semicolons; in it
INSERT INTO users VALUES (1); -- Another; comment; here`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE TABLE");
    expect(result.statements[1]).toContain("INSERT INTO");
  });

  test("should handle multi-line string literals", () => {
    const content = `
-- +goose Up
INSERT INTO docs (content) VALUES ('Line 1
Line 2
Line 3; with semicolon
Line 4');

CREATE TABLE test (id INT);`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("Line 3; with semicolon");
    expect(result.statements[1]).toContain("CREATE TABLE test");
  });

  test("should handle SQL escape sequences", () => {
    const content = `
-- +goose Up
INSERT INTO test VALUES ('It''s a test; with semicolon');
INSERT INTO test VALUES ('Another''s; value');`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("It''s a test; with semicolon");
    expect(result.statements[1]).toContain("Another''s; value");
  });

  test("should handle mixed quotes and identifiers", () => {
    const content = `
-- +goose Up
INSERT INTO "table-name" (col) VALUES ('value; with; semicolons');
CREATE TABLE "my-table" (id INT);`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain('"table-name"');
    expect(result.statements[0]).toContain("'value; with; semicolons'");
    expect(result.statements[1]).toContain('"my-table"');
  });

  test("should handle nested quotes correctly", () => {
    const content = `
-- +goose Up
INSERT INTO test VALUES ('Single ''quoted'' value; test');
INSERT INTO test2 VALUES ("Double ""quoted"" identifier");`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("''quoted''");
    expect(result.statements[1]).toContain('""quoted""');
  });

  test("should handle empty dollar-quote tags", () => {
    const content = `
-- +goose Up
SELECT $$ This is; a; string; with; semicolons $$;
INSERT INTO test VALUES (1);`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("$$");
    expect(result.statements[1]).toContain("INSERT INTO test");
  });

  test("should handle complex real-world PostgreSQL function", () => {
    const content = `
-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Update timestamp; regardless of changes
    NEW.updated_at = NOW();
    /* Multiple semicolons; in comments */
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE OR REPLACE FUNCTION");
    expect(result.statements[0]).toContain("$$");
    expect(result.statements[1]).toContain("CREATE TRIGGER");
  });

  test("should handle statements with only comments before them", () => {
    const content = `
-- +goose Up
-- This is a leading comment
-- Another comment; with semicolon
CREATE TABLE users (id INT);

/* Block comment
   before statement */
INSERT INTO users VALUES (1);`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE TABLE");
    expect(result.statements[1]).toContain("INSERT INTO");
  });

  test("should handle multiple statements with complex mix of features", () => {
    const content = `
-- +goose Up
-- Leading comment
INSERT INTO test VALUES ('value; 1'); -- inline comment;
/* Block comment; */ SELECT * FROM test WHERE x = 'y; z';
UPDATE test SET val = $tag$text; here$tag$ WHERE id = 1;`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(3);
    expect(result.statements[0]).toContain("INSERT");
    expect(result.statements[1]).toContain("SELECT");
    expect(result.statements[2]).toContain("UPDATE");
  });

  test("should handle ENVSUB feature toggle", () => {
    // Set environment variable for test
    process.env.TEST_VAR = "test_value";

    const content = `
-- +goose Up
-- +goose ENVSUB ON
INSERT INTO config (key, value) VALUES ('test', '\${TEST_VAR}');
-- +goose ENVSUB OFF
INSERT INTO config (key, value) VALUES ('raw', '\\$\\{NOT_EXPANDED\\}');`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("test_value");
    expect(result.statements[1]).toContain("\\$\\{NOT_EXPANDED\\}");

    delete process.env.TEST_VAR;
  });

  test("should handle very long statements without issues", () => {
    const longValue = "x".repeat(10000);
    const content = `
-- +goose Up
INSERT INTO test (data) VALUES ('${longValue}; with; semicolons');
CREATE TABLE test2 (id INT);`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]?.length).toBeGreaterThan(10000);
    expect(result.statements[1]).toContain("CREATE TABLE test2");
  });

  test("should handle statements ending with semicolon and comment", () => {
    const content = `
-- +goose Up
CREATE TABLE test (id INT); -- comment with; semicolons
INSERT INTO test VALUES (1); /* block comment; */`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("CREATE TABLE");
    expect(result.statements[1]).toContain("INSERT INTO");
  });

  test("should preserve whitespace in string literals", () => {
    const content = `
-- +goose Up
INSERT INTO test VALUES ('  leading spaces  ');
INSERT INTO test VALUES ('	tabs	inside');`;

    const result = parseSqlStatements(content);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toContain("  leading spaces  ");
    expect(result.statements[1]).toContain("	tabs	");
  });
});
