#!/usr/bin/env bun
/**
 * Extract the release notes of a tag from the CHANGELOG.md committed at that tag.
 *
 * Usage: bun scripts/generate-release-notes.ts <tag> <commit-sha> --output <file>
 *
 * Contract enforced by .github/workflows/release.yml:
 * - `<tag>` must match ^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$ (stable releases only).
 * - `<commit-sha>` must resolve to the same commit as refs/tags/<tag> (annotated and
 *   lightweight tags both peel to their commit).
 * - Notes are read with `git show <sha>:CHANGELOG.md`, never from the working tree.
 * - The `## [X.Y.Z]` section (optional date suffix) is matched exactly: 1.2.0 never
 *   matches 1.20.0. The body runs to the next `## ` heading, code fences are respected,
 *   line endings are normalized, and the body always ends with a newline.
 * - Missing, empty, or duplicate sections fail with a nonzero exit code; there is no
 *   fallback to commit-generated notes.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CHANGELOG_PATH = "CHANGELOG.md";

export class ReleaseNotesError extends Error {}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateFence(fence: string | null, line: string): string | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (fence === null) return match ? match[1]![0]! : null;
  if (match && match[1]![0] === fence) return null;
  return fence;
}

/**
 * Pure extraction: return the body of the `## [<version>]` section, excluding the
 * heading, trimmed of surrounding blank lines and terminated by a newline.
 * Throws ReleaseNotesError on a missing, empty, or duplicate section.
 */
export function extractReleaseNotes(changelog: string, version: string): string {
  const lines = changelog.replace(/\r\n?/g, "\n").split("\n");
  const headerPattern = new RegExp(
    `^ {0,3}## \\[${escapeRegExp(version)}\\](?:[ \\t]+.*)?$`,
  );

  let fence: string | null = null;
  let targetIndex = -1;
  let duplicateCount = 0;
  const sectionHeaders: number[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    fence = updateFence(fence, line);
    if (fence !== null) continue;
    if (/^ {0,3}## /.test(line)) {
      sectionHeaders.push(index);
      if (headerPattern.test(line)) {
        if (targetIndex !== -1) duplicateCount += 1;
        else targetIndex = index;
      }
    }
  }

  if (targetIndex === -1) {
    throw new ReleaseNotesError(`no "## [${version}]" section in ${CHANGELOG_PATH}`);
  }
  if (duplicateCount > 0) {
    throw new ReleaseNotesError(`duplicate "## [${version}]" sections in ${CHANGELOG_PATH}`);
  }

  let endIndex = lines.length;
  for (const index of sectionHeaders) {
    if (index > targetIndex) {
      endIndex = index;
      break;
    }
  }

  const body = lines.slice(targetIndex + 1, endIndex);
  while (body.length > 0 && body[0]!.trim() === "") body.shift();
  while (body.length > 0 && body[body.length - 1]!.trim() === "") body.pop();
  if (body.length === 0) {
    throw new ReleaseNotesError(`empty "## [${version}]" section in ${CHANGELOG_PATH}`);
  }
  return `${body.join("\n")}\n`;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReleaseNotesError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function parseArgs(argv: string[]): { tag: string; eventRef: string; output: string } {
  const positional: string[] = [];
  let output: string | null = null;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--output") {
      output = argv[index + 1] ?? null;
      if (output === null) throw new ReleaseNotesError("--output requires a file path");
      index += 1;
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    } else if (arg === "--end-of-options") {
      continue;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 2) {
    throw new ReleaseNotesError(
      "usage: bun scripts/generate-release-notes.ts <tag> <commit-sha> --output <file>",
    );
  }
  if (output === null) {
    throw new ReleaseNotesError("missing required --output <file>");
  }
  return { tag: positional[0]!, eventRef: positional[1]!, output };
}

function main(argv: string[]): void {
  try {
    const { tag, eventRef, output } = parseArgs(argv);

    if (!TAG_PATTERN.test(tag)) {
      throw new ReleaseNotesError(`invalid tag "${tag}": expected vX.Y.Z`);
    }
    const version = tag.slice(1);

    const eventCommit = git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${eventRef}^{commit}`,
    ]).trim();
    const tagCommit = git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `refs/tags/${tag}^{commit}`,
    ]).trim();
    if (eventCommit !== tagCommit) {
      throw new ReleaseNotesError(
        `${eventRef} (${eventCommit}) does not point at refs/tags/${tag} (${tagCommit})`,
      );
    }

    const changelog = git(["show", `${tagCommit}:${CHANGELOG_PATH}`]);
    const notes = extractReleaseNotes(changelog, version);
    writeFileSync(output, notes);
    console.log(
      `generate-release-notes: wrote ${output} from ${tag} (${eventCommit.slice(0, 12)})`,
    );
  } catch (error) {
    if (error instanceof ReleaseNotesError) {
      console.error(`generate-release-notes: error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main(process.argv.slice(2));
