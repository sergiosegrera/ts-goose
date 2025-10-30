import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SQL } from "bun";
import { downCommand } from "../commands/down";
import { downToCommand } from "../commands/down-to";
import { resetCommand } from "../commands/reset";
import { statusCommand } from "../commands/status";
import { upCommand } from "../commands/up";
import { upByOneCommand } from "../commands/up-by-one";
import { upToCommand } from "../commands/up-to";
import { SQLiteStore } from "../store-sqlite";

// Test migration directory
const TEST_MIGRATION_DIR = path.join(
  import.meta.dir,
  "test_migrations_integration",
);
const TEST_TABLE_NAME = "test_goose_migrations";

// Setup and teardown
beforeEach(async () => {
  // Create test migration directory
  await rm(TEST_MIGRATION_DIR, { recursive: true, force: true });
  await mkdir(TEST_MIGRATION_DIR, { recursive: true });
});

afterEach(async () => {
  try {
    // Clean up test migration directory
    await rm(TEST_MIGRATION_DIR, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to clean up ${TEST_MIGRATION_DIR}:`, error);
  }
});

describe("Commands - Integration Tests with SQLite", () => {
  test("should create migrations table and apply a migration", async () => {
    const db = new SQL("sqlite::memory:");

    // Create a test migration
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_create_users.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify migrations table exists
    const migrationsTableExists = await SQLiteStore.checkTableExists(
      db,
      TEST_TABLE_NAME,
    );
    expect(migrationsTableExists).toBe(true);

    // Verify users table was created
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(1);
    expect(versions[0]?.version_id).toBe(1000000000000n);

    // Verify we can query the users table
    const result = await db<
      { name: string }[]
    >`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`;
    expect(result.length).toBeGreaterThan(0);
  });

  test("should apply multiple migrations in order and verify data persistence", async () => {
    const db = new SQL("sqlite::memory:");

    // Create multiple migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_create_users.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_create_posts.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, FOREIGN KEY(user_id) REFERENCES users(id));\n\n-- +goose Down\nDROP TABLE posts;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify both migrations were applied
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(2);
    expect(versions[0]?.version_id).toBe(1000000000001n);
    expect(versions[1]?.version_id).toBe(1000000000002n);

    // Verify both tables exist
    const tablesResult = await db<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;

    expect(tablesResult.length).toBe(2);
  });

  test("should rollback last migration and verify table is dropped", async () => {
    const db = new SQL("sqlite::memory:");

    // Create migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_create_users.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_create_posts.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER);\n\n-- +goose Down\nDROP TABLE posts;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply all migrations
    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    // Rollback one
    await downCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify only first migration is applied
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(1);
    expect(versions[0]?.version_id).toBe(1000000000001n);

    // Verify posts table is dropped but users table exists
    const tablesResult = await db<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;
    expect(tablesResult.length).toBe(1);
    expect(tablesResult[0]?.name).toBe("users");
  });

  test("should handle upByOne correctly", async () => {
    const db = new SQL("sqlite::memory:");

    // Create multiple migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE posts;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply only first migration
    await upByOneCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify only first migration is applied
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(1);
    expect(versions[0]?.version_id).toBe(1000000000001n);

    // Verify only users table exists
    const tablesResult = await db<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;
    expect(tablesResult.length).toBe(1);
  });

  test("should handle upTo command correctly", async () => {
    const db = new SQL("sqlite::memory:");

    // Create multiple migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000003_third.sql"),
      "-- +goose Up\nCREATE TABLE comments (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE comments;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply up to version 2
    await upToCommand(
      db,
      SQLiteStore,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000002n,
    );

    console.log = originalLog;

    // Verify only first two migrations are applied
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(2);

    // Verify only users and posts tables exist, not comments
    const tablesResult = await db<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts', 'comments')`;
    expect(tablesResult.length).toBe(2);
  });

  test("should handle downTo command correctly", async () => {
    const db = new SQL("sqlite::memory:");

    // Create multiple migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000003_third.sql"),
      "-- +goose Up\nCREATE TABLE comments (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE comments;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply all
    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    // Rollback to version 1
    await downToCommand(
      db,
      SQLiteStore,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000001n,
    );

    console.log = originalLog;

    // Verify only first migration remains
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(1);

    // Verify only users table exists
    const tablesResult = await db<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts', 'comments')`;
    expect(tablesResult.length).toBe(1);
    expect(tablesResult[0]?.name).toBe("users");
  });

  test("should handle reset command and rollback all migrations", async () => {
    const db = new SQL("sqlite::memory:");

    // Create multiple migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE posts;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply all
    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    // Reset
    await resetCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify no migrations remain
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(0);

    // Verify no user-created tables exist (migrations table still exists)
    const tablesResult = await db<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;
    expect(tablesResult.length).toBe(0);
  });

  test("should handle NO TRANSACTION directive with real database", async () => {
    const db = new SQL("sqlite::memory:");

    // Create a migration with NO TRANSACTION directive
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_no_transaction.sql"),
      "-- +goose NO TRANSACTION\n-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY);\nINSERT INTO users (id) VALUES (1);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify migration was applied
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(1);

    // Verify data was inserted
    const result = await db<{ id: number }[]>`SELECT * FROM users`;
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe(1);
  });

  test("should handle transactions correctly by default", async () => {
    const db = new SQL("sqlite::memory:");

    // Create a migration without NO TRANSACTION
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_with_transaction.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY);\nINSERT INTO users (id) VALUES (1);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify migration was applied with transaction
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(1);

    // Verify data exists
    const result = await db<{ id: number }[]>`SELECT * FROM users`;
    expect(result.length).toBe(1);
  });

  test("should handle TypeScript migrations", async () => {
    const db = new SQL("sqlite::memory:");

    // Create a TypeScript migration
    const tsMigrationCode = `import type { TransactionSQL } from "bun";

export const up = async (tx: TransactionSQL) => {
  await tx\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)\`;
  await tx\`INSERT INTO users (name) VALUES ('Alice')\`;
};

export const down = async (tx: TransactionSQL) => {
  await tx\`DROP TABLE users\`;
};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_ts_migration.ts"),
      tsMigrationCode,
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify migration was applied
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(1);
  });

  test("should handle mixed SQL and TypeScript migrations", async () => {
    const db = new SQL("sqlite::memory:");

    // SQL migration
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_sql.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY);\n\n-- +goose Down\nDROP TABLE users;",
    );

    // TypeScript migration
    const tsMigrationCode = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {
  await tx\`INSERT INTO users (id) VALUES (1)\`;
};
export const down = async (tx: TransactionSQL) => {
  await tx\`DELETE FROM users\`;
};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_ts.ts"),
      tsMigrationCode,
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify both migrations applied
    const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
    expect(versions.length).toBe(2);
  });

  test("should maintain data integrity across migrations", async () => {
    const db = new SQL("sqlite::memory:");

    // Create schema
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_create_users.sql"),
      "-- +goose Up\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n\n-- +goose Down\nDROP TABLE users;",
    );

    // Add column
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_add_email.sql"),
      "-- +goose Up\nALTER TABLE users ADD COLUMN email TEXT;\n\n-- +goose Down\nALTER TABLE users DROP COLUMN email;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply first migration
    await upByOneCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    // Insert data
    await db<{ name: string }[]>`INSERT INTO users (name) VALUES ('Alice')`;
    await db<{ name: string }[]>`INSERT INTO users (name) VALUES ('Bob')`;

    // Apply second migration
    await upByOneCommand(db, SQLiteStore, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    // Verify data is still there
    const result = await db<
      { id: number; name: string; email?: string }[]
    >`SELECT * FROM users`;
    expect(result.length).toBe(2);

    // Verify new column exists
    const columns = await db<{ name: string }[]>`
      PRAGMA table_info(users)`;
    const hasEmailColumn = columns.some((col) => col?.name === "email");
    expect(hasEmailColumn).toBe(true);
  });

  test("should handle realistic development workflow with multiple commands", async () => {
    const db = new SQL("sqlite::memory:");

    // Mock console.log to prevent command output in test results
    const originalLog = console.log;
    console.log = mock(() => {});

    try {
      // Create migrations for a simple blog schema
      await writeFile(
        path.join(TEST_MIGRATION_DIR, "1000000000001_create_users.sql"),
        `-- +goose Up
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
-- +goose Down
DROP TABLE users;`,
      );

      await writeFile(
        path.join(TEST_MIGRATION_DIR, "1000000000002_create_posts.sql"),
        `-- +goose Up
CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT);
-- +goose Down
DROP TABLE posts;`,
      );

      // Step 1: Check status (shows pending migrations)
      await statusCommand(db, SQLiteStore, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });

      // Step 2: Apply first migration incrementally
      await upByOneCommand(db, SQLiteStore, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });

      // Verify users table exists
      let tables = await db<{ name: string }[]>`
        SELECT name FROM sqlite_master WHERE type='table' AND name='users'`;
      expect(tables.length).toBe(1);

      // Step 3: Insert data and continue development
      await db`INSERT INTO users (name) VALUES ('Alice')`;

      // Step 4: Apply remaining migrations at once
      await upCommand(db, SQLiteStore, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });

      // Verify both tables exist
      tables = await db<{ name: string }[]>`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;
      expect(tables.length).toBe(2);

      // Step 5: Add more data
      await db`INSERT INTO posts (user_id, title) VALUES (1, 'First Post')`;

      // Step 6: Test rollback
      await downCommand(db, SQLiteStore, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });

      // Verify posts table gone but users data preserved
      tables = await db<{ name: string }[]>`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;
      expect(tables.length).toBe(1);

      const users = await db<{ name: string }[]>`SELECT name FROM users`;
      expect(users.length).toBe(1);

      // Step 7: Apply migrations up to specific version
      await upToCommand(
        db,
        SQLiteStore,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000002n,
      );

      // Verify posts table back
      tables = await db<{ name: string }[]>`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;
      expect(tables.length).toBe(2);

      // Step 8: Test down-to rollback
      await downToCommand(
        db,
        SQLiteStore,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000001n,
      );

      // Verify only users table remains
      tables = await db<{ name: string }[]>`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')`;
      expect(tables.length).toBe(1);

      // Step 9: Complete reset
      await resetCommand(db, SQLiteStore, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });

      // Verify clean state
      const versions = await SQLiteStore.getVersions(db, TEST_TABLE_NAME);
      expect(versions.length).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });
});
