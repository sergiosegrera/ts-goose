import { version } from "../package.json";

export function versionCommand() {
  console.log(`ts-goose v${version}`);
}
