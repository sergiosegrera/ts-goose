#!/usr/bin/env bun
import { createCommand } from "./commands/create";
import { downCommand } from "./commands/down";
import { downToCommand } from "./commands/down-to";
import { helpCommand } from "./commands/help";
import { resetCommand } from "./commands/reset";
import { statusCommand } from "./commands/status";
import { upCommand } from "./commands/up";
import { upByOneCommand } from "./commands/up-by-one";
import { upToCommand } from "./commands/up-to";
import { versionCommand } from "./commands/version";
import {
  exitSuccess,
  handleInvalidArgument,
  handleVersionError,
} from "./error-handler";
import { initializeDatabase } from "./init";

// Wrap CLI execution to handle async exits
async function main() {
  const command = process.argv[2];

  const commands = {
    create: "create",
    up: "up",
    "up-by-one": "up-by-one",
    "up-to": "up-to",
    status: "status",
    down: "down",
    "down-to": "down-to",
    reset: "reset",
    version: "version",
    help: "help",
  };

  // Handle special flags and no command
  if (!command || command === "--help" || command === "-h") {
    helpCommand();
    exitSuccess();
  }

  if (command === "--version" || command === "-v") {
    versionCommand();
    exitSuccess();
  }

  if (!command || !Object.keys(commands).includes(command)) {
    handleInvalidArgument(
      `Invalid command: ${command || "undefined"}. Run "ts-goose help" for usage information.`,
      {},
    );
  }

  switch (command) {
    case "create": {
      const args = process.argv.slice(3);
      await createCommand(args);
      break;
    }

    case "status": {
      const { db, store, config } = initializeDatabase();
      await statusCommand(db, store, config);
      break;
    }

    case "up": {
      const { db, store, config } = initializeDatabase();
      await upCommand(db, store, config);
      break;
    }

    case "up-by-one": {
      const { db, store, config } = initializeDatabase();
      await upByOneCommand(db, store, config);
      break;
    }

    case "up-to": {
      const targetVersion = process.argv[3];
      if (!targetVersion) {
        handleInvalidArgument(
          "VERSION argument is required. Usage: ts-goose up-to <VERSION>",
          { command: "up-to" },
        );
      }
      try {
        const versionBigInt = BigInt(targetVersion);
        const { db, store, config } = initializeDatabase();
        await upToCommand(db, store, config, versionBigInt);
      } catch {
        handleVersionError(targetVersion, { command: "up-to" });
      }
      break;
    }

    case "down": {
      const { db, store, config } = initializeDatabase();
      await downCommand(db, store, config);
      break;
    }

    case "down-to": {
      const targetVersion = process.argv[3];
      if (!targetVersion) {
        handleInvalidArgument(
          "VERSION argument is required. Usage: ts-goose down-to <VERSION>",
          { command: "down-to" },
        );
      }
      try {
        const versionBigInt = BigInt(targetVersion);
        const { db, store, config } = initializeDatabase();
        await downToCommand(db, store, config, versionBigInt);
      } catch {
        handleVersionError(targetVersion, { command: "down-to" });
      }
      break;
    }

    case "reset": {
      const { db, store, config } = initializeDatabase();
      await resetCommand(db, store, config);
      break;
    }

    case "version": {
      versionCommand();
      break;
    }

    case "help": {
      helpCommand();
      break;
    }
  }
}

// Execute the CLI
main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
