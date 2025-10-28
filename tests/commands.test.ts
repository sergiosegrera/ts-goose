import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SQL, TransactionSQL } from "bun";
import { downCommand } from "../commands/down";
import { upCommand } from "../commands/up";
import { upByOneCommand } from "../commands/up-by-one";
import type { Store } from "../store";

// Test migration directory
const TEST_MIGRATION_DIR = path.join(
  import.meta.dir,
  "test_migrations_commands",
);
const TEST_TABLE_NAME = "test_goose_migrations";

// Create a mock store
function createMockStore() {
  const appliedVersions: bigint[] = [];
  const executedStatements: string[] = [];
  const mockCalls = {
    checkTableExists: 0,
    createTable: 0,
    getVersions: 0,
    runMigration: 0,
    insertVersion: 0,
    deleteVersion: 0,
  };

  let tableExists = false;

  const store: Store = {
    checkTableExists: mock(async (_db: SQL, _tableName: string) => {
      mockCalls.checkTableExists++;
      return tableExists;
    }),
    createTable: mock(async (_db: SQL, _tableName: string) => {
      mockCalls.createTable++;
      tableExists = true;
    }),
    getVersions: mock(async (_db: SQL, _tableName: string) => {
      mockCalls.getVersions++;
      return appliedVersions.map((version_id) => ({
        version_id,
        applied_at: new Date(),
      }));
    }),
    runMigration: mock(async (_tx: TransactionSQL, statement: string) => {
      mockCalls.runMigration++;
      executedStatements.push(statement);
    }),
    insertVersion: mock(
      async (_tx: TransactionSQL, _tableName: string, version: bigint) => {
        mockCalls.insertVersion++;
        appliedVersions.push(version);
      },
    ),
    deleteVersion: mock(
      async (_tx: TransactionSQL, _tableName: string, version: bigint) => {
        mockCalls.deleteVersion++;
        const index = appliedVersions.indexOf(version);
        if (index > -1) {
          appliedVersions.splice(index, 1);
        }
      },
    ),
  };

  return {
    store,
    mockCalls,
    appliedVersions,
    executedStatements,
    setTableExists: (exists: boolean) => {
      tableExists = exists;
    },
  };
}

// Create a mock database with transaction support
function createMockDB() {
  const db = {
    begin: mock(async (callback: (tx: TransactionSQL) => Promise<void>) => {
      // Create a simple mock transaction object
      const tx = {} as TransactionSQL;
      await callback(tx);
    }),
  } as unknown as SQL;

  return db;
}

// Setup and teardown
beforeEach(async () => {
  // Create test migration directory
  await rm(TEST_MIGRATION_DIR, { recursive: true, force: true });
  await mkdir(TEST_MIGRATION_DIR, { recursive: true });
});

afterEach(async () => {
  // Clean up test migration directory
  await rm(TEST_MIGRATION_DIR, { recursive: true, force: true });
});

describe("Commands - upCommand", () => {
  test("should create table if it doesn't exist", async () => {
    const { store, mockCalls, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(false);

    // Create a test migration
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_test.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );

    // Mock console to avoid output
    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.checkTableExists).toBe(1);
    expect(mockCalls.createTable).toBe(1);
  });

  test("should skip creating table if it already exists", async () => {
    const { store, mockCalls, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create a test migration
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_test.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.checkTableExists).toBe(1);
    expect(mockCalls.createTable).toBe(0);
  });

  test("should exit if no migrations to apply", async () => {
    const { store, setTableExists, appliedVersions } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create a test migration and mark it as applied
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_test.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    appliedVersions.push(1000000000000n);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await upCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch (e) {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(0);
  });

  test("should apply single migration", async () => {
    const { store, mockCalls, executedStatements, appliedVersions } =
      createMockStore();
    const db = createMockDB();

    // Create a test migration
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_test.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose Up\nCREATE TABLE users (id INT);\nINSERT INTO users (id) VALUES (1);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.runMigration).toBe(2);
    expect(mockCalls.insertVersion).toBe(1);
    expect(executedStatements).toContain("CREATE TABLE users (id INT);");
    expect(executedStatements).toContain("INSERT INTO users (id) VALUES (1);");
    expect(appliedVersions).toContain(1000000000000n);
  });

  test("should apply multiple migrations in order", async () => {
    const { store, mockCalls, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create multiple test migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000003_third.sql"),
      "-- +goose Up\nCREATE TABLE comments (id INT);\n\n-- +goose Down\nDROP TABLE comments;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(3);
    expect(appliedVersions).toEqual([
      1000000000001n,
      1000000000002n,
      1000000000003n,
    ]);
  });

  test("should handle empty migration file", async () => {
    const { store, mockCalls, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create an empty migration
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_empty.sql"),
      "-- +goose Up\n\n-- +goose Down\n",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.runMigration).toBe(0);
    expect(mockCalls.insertVersion).toBe(1);
    expect(appliedVersions).toContain(1000000000000n);
  });

  test("should handle migration error and exit", async () => {
    const { store, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Override runMigration to throw an error
    store.runMigration = mock(async () => {
      throw new Error("SQL Error: syntax error");
    });

    // Create a test migration
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_test.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalExit = process.exit;
    const originalError = console.error;
    const originalLog = console.log;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});
    console.log = mock(() => {});

    try {
      await upCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch (e) {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;

    expect(exitCode).toBe(1);
  });
});

describe("Commands - upByOneCommand", () => {
  test("should apply only first unapplied migration", async () => {
    const { store, mockCalls, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create multiple test migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(1);
    expect(appliedVersions).toEqual([1000000000001n]);
    expect(appliedVersions).not.toContain(1000000000002n);
  });

  test("should apply second migration if first is already applied", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Mark first migration as applied
    appliedVersions.push(1000000000001n);

    // Create multiple test migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(appliedVersions).toContain(1000000000002n);
    expect(appliedVersions.length).toBe(2);
  });

  test("should exit if no migrations to apply", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create a test migration and mark it as applied
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_test.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    appliedVersions.push(1000000000000n);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await upByOneCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch (e) {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(0);
  });

  test("should create table if it doesn't exist", async () => {
    const { store, mockCalls, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(false);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_test.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.checkTableExists).toBe(1);
    expect(mockCalls.createTable).toBe(1);
  });
});

describe("Commands - downCommand", () => {
  test("should exit if table doesn't exist", async () => {
    const { store, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(false);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await downCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch (e) {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should exit if no migrations to rollback", async () => {
    const { store, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await downCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch (e) {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should rollback last applied migration", async () => {
    const { store, appliedVersions, executedStatements, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create a test migration and mark it as applied
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_test.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    appliedVersions.push(1000000000000n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(executedStatements).toContain("DROP TABLE users;");
    expect(appliedVersions).not.toContain(1000000000000n);
    expect(appliedVersions.length).toBe(0);
  });

  test("should rollback only the last migration", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create multiple test migrations and mark them as applied
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    appliedVersions.push(1000000000001n);
    appliedVersions.push(1000000000002n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(appliedVersions).toContain(1000000000001n);
    expect(appliedVersions).not.toContain(1000000000002n);
    expect(appliedVersions.length).toBe(1);
  });

  test("should exit if local version file doesn't exist", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Mark a migration as applied but don't create the file
    appliedVersions.push(1000000000000n);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await downCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch (e) {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should handle empty down section", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create migration with empty down section
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_test.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\n",
    );
    appliedVersions.push(1000000000000n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.runMigration).toBe(0);
    expect(mockCalls.deleteVersion).toBe(1);
    expect(appliedVersions).not.toContain(1000000000000n);
  });

  test("should handle migration with multiple statements", async () => {
    const { store, appliedVersions, executedStatements, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_test.sql"),
      `-- +goose Up
CREATE TABLE users (id INT);
CREATE TABLE posts (id INT);

-- +goose Down
DROP TABLE posts;
DROP TABLE users;`,
    );
    appliedVersions.push(1000000000000n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(executedStatements).toContain("DROP TABLE posts;");
    expect(executedStatements).toContain("DROP TABLE users;");
    expect(appliedVersions).not.toContain(1000000000000n);
  });
});

describe("Commands - Integration Tests", () => {
  test("should apply migrations with up and rollback with down", async () => {
    const { store, appliedVersions, executedStatements } = createMockStore();
    const db = createMockDB();

    // Create test migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_users.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_posts.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply all migrations
    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    expect(appliedVersions.length).toBe(2);
    expect(executedStatements).toContain("CREATE TABLE users (id INT);");
    expect(executedStatements).toContain("CREATE TABLE posts (id INT);");

    // Rollback last migration
    await downCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    expect(appliedVersions.length).toBe(1);
    expect(executedStatements).toContain("DROP TABLE posts;");
    expect(appliedVersions).toContain(1000000000001n);
    expect(appliedVersions).not.toContain(1000000000002n);

    console.log = originalLog;
  });

  test("should apply migrations one by one", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();

    // Create test migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000003_third.sql"),
      "-- +goose Up\nCREATE TABLE comments (id INT);\n\n-- +goose Down\nDROP TABLE comments;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply first migration
    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });
    expect(appliedVersions.length).toBe(1);

    // Apply second migration
    setTableExists(true);
    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });
    expect(appliedVersions.length).toBe(2);

    // Apply third migration
    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });
    expect(appliedVersions.length).toBe(3);

    expect(appliedVersions).toEqual([
      1000000000001n,
      1000000000002n,
      1000000000003n,
    ]);

    console.log = originalLog;
  });
});
