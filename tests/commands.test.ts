import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SQL, TransactionSQL } from "bun";
import { downCommand } from "../commands/down";
import { downToCommand } from "../commands/down-to";
import { resetCommand } from "../commands/reset";
import { upCommand } from "../commands/up";
import { upByOneCommand } from "../commands/up-by-one";
import { upToCommand } from "../commands/up-to";
import type { Store } from "../store";

// Mock import utility for testing
async function mockImport<T>(modulePath: string, factory: () => T): Promise<T> {
  const mockModule = factory();
  mock.module(modulePath, () => mockModule);
  return mockModule;
}

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
    runMigration: mock(
      async (_db: SQL, statements: string[], _transaction: boolean) => {
        mockCalls.runMigration++;
        executedStatements.push(...statements);
      },
    ),
    insertVersion: mock(
      async (_db: SQL, _tableName: string, version: bigint) => {
        mockCalls.insertVersion++;
        appliedVersions.push(version);
      },
    ),
    deleteVersion: mock(
      async (_db: SQL, _tableName: string, version: bigint) => {
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
    } catch {
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

    expect(mockCalls.runMigration).toBe(1);
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
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;

    expect(exitCode).toBe(4); // MIGRATION_ERROR
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
    } catch {
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

describe("Commands - createCommand", () => {
  test("should create SQL migration with valid name", async () => {
    const { createMigration } = await mockImport("../migration", () => ({
      createMigration: mock(() => Promise.resolve()),
    }));

    const { createCommand } = await import("../commands/create");

    await createCommand(["test_migration"]);

    expect(createMigration).toHaveBeenCalledWith(
      "test_migration",
      expect.any(String),
      "sql",
    );
  });

  test("should create TypeScript migration when type is ts", async () => {
    const { createMigration } = await mockImport("../migration", () => ({
      createMigration: mock(() => Promise.resolve()),
    }));

    const { createCommand } = await import("../commands/create");

    await createCommand(["test_migration", "ts"]);

    expect(createMigration).toHaveBeenCalledWith(
      "test_migration",
      expect.any(String),
      "ts",
    );
  });

  test("should default to SQL when type is invalid", async () => {
    const { createMigration } = await mockImport("../migration", () => ({
      createMigration: mock(() => Promise.resolve()),
    }));

    const { createCommand } = await import("../commands/create");

    await createCommand(["test_migration", "invalid"]);

    expect(createMigration).toHaveBeenCalledWith(
      "test_migration",
      expect.any(String),
      "sql",
    );
  });

  test("should exit with error when name is missing", async () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;
    let loggedMessage: string | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;

    console.error = mock((message: string) => {
      loggedMessage = message;
    }) as never;

    const { createCommand } = await import("../commands/create");

    try {
      await createCommand([]);
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(2); // INVALID_ARGUMENT
    expect(loggedMessage).toBe(
      'Error: Command "create": Migration name is required and cannot be empty',
    );

    process.exit = originalExit;
    console.error = originalError;
  });

  test("should exit with error when name is empty", async () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;
    let loggedMessage: string | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;

    console.error = mock((message: string) => {
      loggedMessage = message;
    }) as never;

    const { createCommand } = await import("../commands/create");

    try {
      await createCommand([""]);
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(2); // INVALID_ARGUMENT
    expect(loggedMessage).toBe(
      'Error: Command "create": Migration name is required and cannot be empty',
    );

    process.exit = originalExit;
    console.error = originalError;
  });

  test("should exit with error when name contains invalid characters", async () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;
    let loggedMessage: string | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;

    console.error = mock((message: string) => {
      loggedMessage = message;
    }) as never;

    const { createCommand } = await import("../commands/create");

    try {
      await createCommand(["test@invalid"]);
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(2); // INVALID_ARGUMENT
    expect(loggedMessage).toBe(
      'Error: Command "create": Migration name "test@invalid" contains invalid characters. Only letters, numbers, hyphens, and underscores are allowed',
    );

    process.exit = originalExit;
    console.error = originalError;
  });

  test("should accept valid names with letters, numbers, hyphens, and underscores", async () => {
    const { createMigration } = await mockImport("../migration", () => ({
      createMigration: mock(() => Promise.resolve()),
    }));

    const { createCommand } = await import("../commands/create");

    // Test various valid combinations
    const validNames = [
      "test",
      "test123",
      "test-name",
      "test_name",
      "test_123-name",
      "MyMigration",
      "migration_v2",
    ];

    for (const name of validNames) {
      await createCommand([name]);
      expect(createMigration).toHaveBeenCalledWith(
        name,
        expect.any(String),
        "sql",
      );
    }
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
    } catch {
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
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(3); // NO_MIGRATIONS
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
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(3); // NO_MIGRATIONS
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

describe("Commands - No Transaction Tests", () => {
  test("should handle NO TRANSACTION directive in up migration", async () => {
    const { store, executedStatements, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create a migration with NO TRANSACTION directive at the top (applies to both up and down)
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_no_transaction.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose NO TRANSACTION\n-- +goose Up\nCREATE INDEX CONCURRENTLY idx_users_email ON users(email);\n\n-- +goose Down\nDROP INDEX IF EXISTS idx_users_email;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Track what transaction value was passed to runMigration
    let capturedTransaction: boolean | undefined;
    store.runMigration = mock(
      async (_db: SQL, statements: string[], transaction: boolean) => {
        capturedTransaction = transaction;
        executedStatements.push(...statements);
      },
    );

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(capturedTransaction).toBe(false);
    expect(executedStatements).toContain(
      "CREATE INDEX CONCURRENTLY idx_users_email ON users(email);",
    );
    expect(appliedVersions).toContain(1000000000000n);
  });

  test("should handle NO TRANSACTION directive in down migration", async () => {
    const { store, executedStatements, appliedVersions, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create a migration with NO TRANSACTION directive at the top (applies to both up and down)
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_no_transaction.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose NO TRANSACTION\n-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP INDEX CONCURRENTLY IF EXISTS idx_users_email;",
    );
    appliedVersions.push(1000000000000n);

    const originalLog = console.log;
    console.log = mock(() => {});

    // Track what transaction value was passed to runMigration
    let capturedTransaction: boolean | undefined;
    store.runMigration = mock(
      async (_db: SQL, statements: string[], transaction: boolean) => {
        capturedTransaction = transaction;
        executedStatements.push(...statements);
      },
    );

    await downCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(capturedTransaction).toBe(false);
    expect(executedStatements).toContain(
      "DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;",
    );
    expect(appliedVersions).not.toContain(1000000000000n);
  });

  test("should default to transaction mode when NO TRANSACTION not specified", async () => {
    const { store, executedStatements, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create a migration without NO TRANSACTION directive
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000000_with_transaction.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose Up\nCREATE TABLE users (id INT);\nINSERT INTO users (id) VALUES (1);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Track what transaction value was passed to runMigration
    let capturedTransaction: boolean | undefined;
    store.runMigration = mock(
      async (_db: SQL, statements: string[], transaction: boolean) => {
        capturedTransaction = transaction;
        executedStatements.push(...statements);
      },
    );

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(capturedTransaction).toBe(true);
    expect(executedStatements).toContain("CREATE TABLE users (id INT);");
    expect(appliedVersions).toContain(1000000000000n);
  });

  test("should handle upByOneCommand with NO TRANSACTION", async () => {
    const { store, executedStatements, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create a migration with NO TRANSACTION directive at the top (applies to both up and down)
    const migrationFile = path.join(
      TEST_MIGRATION_DIR,
      "1000000000001_no_transaction.sql",
    );
    await writeFile(
      migrationFile,
      "-- +goose NO TRANSACTION\n-- +goose Up\nCREATE INDEX CONCURRENTLY idx_users_name ON users(name);\n\n-- +goose Down\nDROP INDEX IF EXISTS idx_users_name;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Track what transaction value was passed to runMigration
    let capturedTransaction: boolean | undefined;
    store.runMigration = mock(
      async (_db: SQL, statements: string[], transaction: boolean) => {
        capturedTransaction = transaction;
        executedStatements.push(...statements);
      },
    );

    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(capturedTransaction).toBe(false);
    expect(executedStatements).toContain(
      "CREATE INDEX CONCURRENTLY idx_users_name ON users(name);",
    );
    expect(appliedVersions).toContain(1000000000001n);
  });

  test("should handle multiple NO TRANSACTION migrations", async () => {
    const { store, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create multiple migrations with NO TRANSACTION directive at the top
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first_no_tx.sql"),
      "-- +goose NO TRANSACTION\n-- +goose Up\nCREATE INDEX CONCURRENTLY idx_users_email ON users(email);\n\n-- +goose Down\nDROP INDEX IF EXISTS idx_users_email;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second_no_tx.sql"),
      "-- +goose NO TRANSACTION\n-- +goose Up\nCREATE INDEX CONCURRENTLY idx_posts_user_id ON posts(user_id);\n\n-- +goose Down\nDROP INDEX IF EXISTS idx_posts_user_id;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    const transactionValues: boolean[] = [];
    store.runMigration = mock(
      async (_db: SQL, _statements: string[], transaction: boolean) => {
        transactionValues.push(transaction);
      },
    );

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(transactionValues).toEqual([false, false]);
    expect(appliedVersions).toEqual([1000000000001n, 1000000000002n]);
  });

  test("should handle mixed transaction and NO TRANSACTION migrations", async () => {
    const { store, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create mix of transaction and no-transaction migrations
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_with_tx.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_no_tx.sql"),
      "-- +goose NO TRANSACTION\n-- +goose Up\nCREATE INDEX CONCURRENTLY idx_users_id ON users(id);\n\n-- +goose Down\nDROP INDEX IF EXISTS idx_users_id;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000003_with_tx_again.sql"),
      "-- +goose Up\nALTER TABLE users ADD COLUMN name VARCHAR(255);\n\n-- +goose Down\nALTER TABLE users DROP COLUMN name;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    const transactionValues: boolean[] = [];
    store.runMigration = mock(
      async (_db: SQL, _statements: string[], transaction: boolean) => {
        transactionValues.push(transaction);
      },
    );

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(transactionValues).toEqual([true, false, true]);
    expect(appliedVersions).toEqual([
      1000000000001n,
      1000000000002n,
      1000000000003n,
    ]);
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

describe("Commands - TypeScript Migrations", () => {
  test("should apply a typescript up migration", async () => {
    const { store, mockCalls, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create a TypeScript migration file
    const tsMigrationCode = `import type { TransactionSQL } from "bun";

export const up = async (tx: TransactionSQL) => {
  // Mock implementation - just tracks that it was called
};

export const down = async (tx: TransactionSQL) => {
  // Mock implementation
};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_create_users.ts"),
      tsMigrationCode,
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(1);
    expect(appliedVersions).toContain(1000000000000n);
  });

  test("should rollback a typescript down migration", async () => {
    const { store, mockCalls, appliedVersions, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create a TypeScript migration file
    const tsMigrationCode = `import type { TransactionSQL } from "bun";

export const up = async (tx: TransactionSQL) => {
  // Mock implementation
};

export const down = async (tx: TransactionSQL) => {
  // Mock implementation
};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000000_drop_users.ts"),
      tsMigrationCode,
    );

    // Mark migration as already applied
    appliedVersions.push(1000000000000n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.deleteVersion).toBe(1);
    expect(appliedVersions).not.toContain(1000000000000n);
  });

  test("should apply multiple typescript migrations in order", async () => {
    const { store, mockCalls, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create multiple TypeScript migration files
    const tsMigrationCode1 = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    const tsMigrationCode2 = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first_migration.ts"),
      tsMigrationCode1,
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second_migration.ts"),
      tsMigrationCode2,
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(2);
    expect(appliedVersions).toEqual([1000000000001n, 1000000000002n]);
  });

  test("should handle mixed SQL and TypeScript migrations", async () => {
    const { store, mockCalls, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create SQL migration
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_sql_migration.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );

    // Create TypeScript migration
    const tsMigrationCode = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_ts_migration.ts"),
      tsMigrationCode,
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(2);
    expect(appliedVersions).toEqual([1000000000001n, 1000000000002n]);
  });

  test("should apply typescript migration with upByOneCommand", async () => {
    const { store, mockCalls, appliedVersions } = createMockStore();
    const db = createMockDB();

    // Create multiple TypeScript migrations
    const tsMigrationCode1 = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    const tsMigrationCode2 = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.ts"),
      tsMigrationCode1,
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.ts"),
      tsMigrationCode2,
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    // Apply only first migration
    await upByOneCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(1);
    expect(appliedVersions).toEqual([1000000000001n]);
    expect(appliedVersions).not.toContain(1000000000002n);
  });
});

describe("Commands - resetCommand", () => {
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
      await resetCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch {
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
    const originalLog = console.log;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.log = mock(() => {});

    try {
      await resetCommand(db, store, {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      });
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.log = originalLog;

    expect(exitCode).toBe(0);
  });

  test("should rollback all migrations in reverse order", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create multiple migrations and mark as applied
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
    appliedVersions.push(1000000000001n, 1000000000002n, 1000000000003n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await resetCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.deleteVersion).toBe(3);
    expect(appliedVersions.length).toBe(0);
  });

  test("should handle missing local migration file gracefully", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create one migration and mark two as applied (one missing)
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    appliedVersions.push(1000000000001n, 1000000000002n);

    const originalLog = console.log;
    const originalError = console.error;
    console.log = mock(() => {});
    console.error = mock(() => {});

    await resetCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;
    console.error = originalError;

    // Should still attempt to delete versions
    expect(mockCalls.deleteVersion).toBe(1);
    expect(appliedVersions.length).toBe(1);
  });

  test("should rollback TypeScript migrations", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    // Create TypeScript migrations
    const tsMigrationCode = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.ts"),
      tsMigrationCode,
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.ts"),
      tsMigrationCode,
    );

    appliedVersions.push(1000000000001n, 1000000000002n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await resetCommand(db, store, {
      migration_dir: TEST_MIGRATION_DIR,
      table_name: TEST_TABLE_NAME,
    });

    console.log = originalLog;

    expect(mockCalls.deleteVersion).toBe(2);
    expect(appliedVersions.length).toBe(0);
  });
});

describe("Commands - upToCommand", () => {
  test("should exit if target version not found", async () => {
    const { store, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await upToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        9999999999999n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should exit if already at target version", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    appliedVersions.push(1000000000001n);

    const originalExit = process.exit;
    const originalLog = console.log;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.log = mock(() => {});

    try {
      await upToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000001n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.log = originalLog;

    expect(exitCode).toBe(0);
  });

  test("should exit if current version is higher than target", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    appliedVersions.push(1000000000001n, 1000000000002n);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await upToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000001n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should migrate to specific version", async () => {
    const { store, appliedVersions, mockCalls } = createMockStore();
    const db = createMockDB();

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

    await upToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000002n,
    );

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(2);
    expect(appliedVersions).toEqual([1000000000001n, 1000000000002n]);
    expect(appliedVersions).not.toContain(1000000000003n);
  });

  test("should migrate from middle version to higher version", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    appliedVersions.push(1000000000001n);

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

    await upToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000003n,
    );

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(2);
    expect(appliedVersions).toEqual([
      1000000000001n,
      1000000000002n,
      1000000000003n,
    ]);
  });

  test("should create table if it doesn't exist", async () => {
    const { store, mockCalls, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(false);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000001n,
    );

    console.log = originalLog;

    expect(mockCalls.createTable).toBe(1);
  });

  test("should handle TypeScript migrations", async () => {
    const { store, appliedVersions, mockCalls } = createMockStore();
    const db = createMockDB();

    const tsMigrationCode = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.ts"),
      tsMigrationCode,
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.ts"),
      tsMigrationCode,
    );

    const originalLog = console.log;
    console.log = mock(() => {});

    await upToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000002n,
    );

    console.log = originalLog;

    expect(mockCalls.insertVersion).toBe(2);
    expect(appliedVersions).toEqual([1000000000001n, 1000000000002n]);
  });
});

describe("Commands - downToCommand", () => {
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
      await downToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000001n,
      );
    } catch {
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
    const originalLog = console.log;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.log = mock(() => {});

    try {
      await downToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000001n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.log = originalLog;

    expect(exitCode).toBe(0);
  });

  test("should exit if already at target version", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    appliedVersions.push(1000000000001n);

    const originalExit = process.exit;
    const originalLog = console.log;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.log = mock(() => {});

    try {
      await downToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000001n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.log = originalLog;

    expect(exitCode).toBe(0);
  });

  test("should exit if current version is lower than target", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    appliedVersions.push(1000000000001n);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await downToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000002n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should exit if target version not found", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    appliedVersions.push(1000000000001n, 1000000000002n);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await downToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        9999999999999n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should exit if target version was not applied", async () => {
    const { store, appliedVersions, setTableExists } = createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    appliedVersions.push(1000000000002n);

    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;
    console.error = mock(() => {});

    try {
      await downToCommand(
        db,
        store,
        {
          migration_dir: TEST_MIGRATION_DIR,
          table_name: TEST_TABLE_NAME,
        },
        1000000000001n,
      );
    } catch {
      // Expected exit
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
  });

  test("should rollback to specific version", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

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
    appliedVersions.push(1000000000001n, 1000000000002n, 1000000000003n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000001n,
    );

    console.log = originalLog;

    expect(mockCalls.deleteVersion).toBe(2);
    expect(appliedVersions).toEqual([1000000000001n]);
  });

  test("should rollback to zero (all migrations)", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.sql"),
      "-- +goose Up\nCREATE TABLE posts (id INT);\n\n-- +goose Down\nDROP TABLE posts;",
    );
    appliedVersions.push(1000000000001n, 1000000000002n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      0n,
    );

    console.log = originalLog;

    expect(mockCalls.deleteVersion).toBe(2);
    expect(appliedVersions.length).toBe(0);
  });

  test("should handle TypeScript migrations", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    const tsMigrationCode = `import type { TransactionSQL } from "bun";
export const up = async (tx: TransactionSQL) => {};
export const down = async (tx: TransactionSQL) => {};`;

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.ts"),
      tsMigrationCode,
    );
    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000002_second.ts"),
      tsMigrationCode,
    );
    appliedVersions.push(1000000000001n, 1000000000002n);

    const originalLog = console.log;
    console.log = mock(() => {});

    await downToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000001n,
    );

    console.log = originalLog;

    expect(mockCalls.deleteVersion).toBe(1);
    expect(appliedVersions).toEqual([1000000000001n]);
  });

  test("should handle missing local migration file gracefully", async () => {
    const { store, appliedVersions, mockCalls, setTableExists } =
      createMockStore();
    const db = createMockDB();
    setTableExists(true);

    await writeFile(
      path.join(TEST_MIGRATION_DIR, "1000000000001_first.sql"),
      "-- +goose Up\nCREATE TABLE users (id INT);\n\n-- +goose Down\nDROP TABLE users;",
    );
    // Mark two migrations as applied, but only one file exists
    appliedVersions.push(1000000000001n, 1000000000002n);

    const originalLog = console.log;
    const originalError = console.error;
    console.log = mock(() => {});
    console.error = mock(() => {});

    await downToCommand(
      db,
      store,
      {
        migration_dir: TEST_MIGRATION_DIR,
        table_name: TEST_TABLE_NAME,
      },
      1000000000001n,
    );

    console.log = originalLog;
    console.error = originalError;

    // Should skip the missing migration file
    expect(mockCalls.deleteVersion).toBe(0);
    expect(appliedVersions.length).toBe(2);
  });
});
