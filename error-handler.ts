/**
 * Centralized error handling and process exit system for ts-goose.
 * Provides standardized error messages, exit codes, and graceful shutdown.
 */

export enum ExitCode {
  SUCCESS = 0,
  ERROR = 1,
  INVALID_ARGUMENT = 2,
  NO_MIGRATIONS = 3,
  MIGRATION_ERROR = 4,
  DATABASE_ERROR = 5,
}

export interface ErrorContext {
  command?: string;
  version?: string | bigint;
  fileName?: string;
  tableName?: string;
  message?: string;
  originalError?: Error;
}

export class GooseError extends Error {
  public readonly exitCode: ExitCode;
  public readonly context: ErrorContext;

  constructor(
    message: string,
    exitCode: ExitCode = ExitCode.ERROR,
    context: ErrorContext = {},
  ) {
    super(message);
    this.name = "GooseError";
    this.exitCode = exitCode;
    this.context = context;
  }
}

/**
 * Handles an error by logging it and exiting the process with the appropriate code.
 * This is the centralized exit function that should be used throughout the application.
 */
export function handleError(
  error: Error | GooseError | string,
  context: ErrorContext = {},
): never {
  let exitCode = ExitCode.ERROR;
  let message = "";

  if (typeof error === "string") {
    message = error;
  } else if (error instanceof GooseError) {
    exitCode = error.exitCode;
    message = error.message;
    // Merge contexts
    Object.assign(context, error.context);
  } else {
    message = error.message || "Unknown error occurred";
  }

  // Add context information to the message
  if (context.command) {
    message = `Command "${context.command}": ${message}`;
  }
  if (context.version) {
    message = `Version ${context.version}: ${message}`;
  }
  if (context.fileName) {
    message = `File "${context.fileName}": ${message}`;
  }
  if (context.tableName) {
    message = `Table "${context.tableName}": ${message}`;
  }

  console.error(`Error: ${message}`);

  // Log additional context if available
  if (context.originalError && context.originalError !== error) {
    console.error(`Details: ${context.originalError.message}`);
  }

  process.exit(exitCode);
}

/**
 * Exits successfully with an optional message.
 */
export function exitSuccess(message?: string): never {
  if (message) {
    console.log(message);
  }

  process.exit(ExitCode.SUCCESS);
}

/**
 * Handles invalid command arguments.
 */
export function handleInvalidArgument(
  message: string,
  context: ErrorContext = {},
): never {
  handleError(new GooseError(message, ExitCode.INVALID_ARGUMENT, context));
}

/**
 * Handles cases where no migrations are available.
 */
export function handleNoMigrations(context: ErrorContext = {}): never {
  handleError(
    new GooseError("No migrations found", ExitCode.NO_MIGRATIONS, context),
  );
}

/**
 * Handles migration execution errors.
 */
export function handleMigrationError(
  message: string,
  context: ErrorContext = {},
): never {
  handleError(new GooseError(message, ExitCode.MIGRATION_ERROR, context));
}

/**
 * Handles database-related errors.
 */
export function handleDatabaseError(
  message: string,
  context: ErrorContext = {},
): never {
  handleError(new GooseError(message, ExitCode.DATABASE_ERROR, context));
}

/**
 * Handles version parsing errors.
 */
export function handleVersionError(
  version: string,
  context: ErrorContext = {},
): never {
  handleError(
    new GooseError(`Invalid version "${version}"`, ExitCode.INVALID_ARGUMENT, {
      ...context,
      version,
    }),
  );
}
