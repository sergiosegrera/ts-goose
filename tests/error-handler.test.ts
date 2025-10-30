import { describe, expect, mock, test } from "bun:test";
import {
  ExitCode,
  exitSuccess,
  GooseError,
  handleDatabaseError,
  handleError,
  handleInvalidArgument,
  handleMigrationError,
  handleNoMigrations,
  handleVersionError,
} from "../error-handler";

describe("Error Handler", () => {
  test("handleError with string message", () => {
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

    try {
      handleError("Test error message");
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.ERROR);
    expect(loggedMessage).toBe("Error: Test error message");

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleError with Error object", () => {
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

    try {
      handleError(new Error("Test error"));
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.ERROR);
    expect(loggedMessage).toBe("Error: Test error");

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleError with GooseError", () => {
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

    const gooseError = new GooseError("Custom error", ExitCode.MIGRATION_ERROR);

    try {
      handleError(gooseError);
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.MIGRATION_ERROR);
    expect(loggedMessage).toBe("Error: Custom error");

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleError with context information", () => {
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

    try {
      handleError("Database error", {
        command: "up",
        tableName: "migrations",
        version: 123n,
      });
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.ERROR);
    expect(loggedMessage).toBe(
      'Error: Table "migrations": Version 123: Command "up": Database error',
    );

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleInvalidArgument", () => {
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

    try {
      handleInvalidArgument("Invalid command syntax");
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.INVALID_ARGUMENT);
    expect(loggedMessage).toBe("Error: Invalid command syntax");

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleNoMigrations", () => {
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

    try {
      handleNoMigrations({ command: "status" });
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.NO_MIGRATIONS);
    expect(loggedMessage).toBe('Error: Command "status": No migrations found');

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleMigrationError", () => {
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

    try {
      handleMigrationError("Syntax error in migration", {
        fileName: "001_test.sql",
        version: 1000000001n,
      });
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.MIGRATION_ERROR);
    expect(loggedMessage).toBe(
      'Error: File "001_test.sql": Version 1000000001: Syntax error in migration',
    );

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleDatabaseError", () => {
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

    try {
      handleDatabaseError("Connection failed", { tableName: "users" });
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.DATABASE_ERROR);
    expect(loggedMessage).toBe('Error: Table "users": Connection failed');

    process.exit = originalExit;
    console.error = originalError;
  });

  test("handleVersionError", () => {
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

    try {
      handleVersionError("invalid-version", { command: "up-to" });
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.INVALID_ARGUMENT);
    expect(loggedMessage).toBe(
      'Error: Version invalid-version: Command "up-to": Invalid version "invalid-version"',
    );

    process.exit = originalExit;
    console.error = originalError;
  });

  test("exitSuccess", () => {
    const originalExit = process.exit;
    const originalLog = console.log;
    let exitCode: number | undefined;
    let loggedMessage: string | undefined;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;

    console.log = mock((message: string) => {
      loggedMessage = message;
    }) as never;

    try {
      exitSuccess("Migration completed successfully");
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.SUCCESS);
    expect(loggedMessage).toBe("Migration completed successfully");

    process.exit = originalExit;
    console.log = originalLog;
  });

  test("exitSuccess without message", () => {
    const originalExit = process.exit;
    const originalLog = console.log;
    let exitCode: number | undefined;
    let logCallCount = 0;

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as never;

    console.log = mock(() => {
      logCallCount++;
    }) as never;

    try {
      exitSuccess();
    } catch {
      // Expected exit
    }

    expect(exitCode).toBe(ExitCode.SUCCESS);
    expect(logCallCount).toBe(0); // No message logged

    process.exit = originalExit;
    console.log = originalLog;
  });

  test("GooseError class", () => {
    const error = new GooseError("Test message", ExitCode.MIGRATION_ERROR, {
      command: "up",
      fileName: "test.sql",
    });

    expect(error.message).toBe("Test message");
    expect(error.exitCode).toBe(ExitCode.MIGRATION_ERROR);
    expect(error.context).toEqual({
      command: "up",
      fileName: "test.sql",
    });
    expect(error.name).toBe("GooseError");
  });

  test("ExitCode enum values", () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.ERROR).toBe(1);
    expect(ExitCode.INVALID_ARGUMENT).toBe(2);
    expect(ExitCode.NO_MIGRATIONS).toBe(3);
    expect(ExitCode.MIGRATION_ERROR).toBe(4);
    expect(ExitCode.DATABASE_ERROR).toBe(5);
  });
});
