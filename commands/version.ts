import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function versionCommand() {
  try {
    // Read package.json to get the version
    // Go up two levels: commands/ -> root/
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = join(currentDir, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    console.log(`ts-goose v${packageJson.version}`);
  } catch {
    console.error("Unable to determine version");
    process.exit(1);
  }
}
