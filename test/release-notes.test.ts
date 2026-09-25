import { describe, expect, test } from "bun:test";
import { ReleaseNotesError, extractReleaseNotes } from "../scripts/generate-release-notes.ts";

const CHANGELOG = `# Changelog

## [1.2.0] - 2026-09-25

Editorial summary of the release.

### Features
- Feature one

### Fixes
- Fix one

## [1.20.0] - 2026-10-01

Later release that must never match 1.2.0.
`;

describe("extractReleaseNotes", () => {
  test("extracts the body of the requested section without the heading", () => {
    const notes = extractReleaseNotes(CHANGELOG, "1.2.0");
    expect(notes).toBe(
      "Editorial summary of the release.\n\n### Features\n- Feature one\n\n### Fixes\n- Fix one\n",
    );
  });

  test("matches the version exactly: 1.2.0 does not match 1.20.0", () => {
    const notes = extractReleaseNotes(CHANGELOG, "1.20.0");
    expect(notes).toBe("Later release that must never match 1.2.0.\n");
  });

  test("keeps a section that ends at the end of the file", () => {
    const notes = extractReleaseNotes(CHANGELOG, "1.20.0");
    expect(notes.endsWith("\n")).toBe(true);
  });

  test("ignores headings inside code fences but keeps the fenced block", () => {
    const changelog = `# Changelog

## [0.1.0] - 2026-09-25

Example:

\`\`\`md
## [not-a-release]
\`\`\`

Real closing content.
`;
    const notes = extractReleaseNotes(changelog, "0.1.0");
    expect(notes).toContain("## [not-a-release]");
    expect(notes).toContain("Real closing content.");
    expect(notes).not.toContain("# Changelog");
  });

  test("normalizes CRLF line endings", () => {
    const changelog = "# Changelog\r\n\r\n## [0.1.0] - 2026-09-25\r\n\r\nBody line.\r\n";
    const notes = extractReleaseNotes(changelog, "0.1.0");
    expect(notes).toBe("Body line.\n");
    expect(notes.includes("\r")).toBe(false);
  });

  test("throws on a missing section", () => {
    expect(() => extractReleaseNotes(CHANGELOG, "9.9.9")).toThrow(ReleaseNotesError);
  });

  test("throws on an empty section", () => {
    const changelog = "# Changelog\n\n## [0.1.0] - 2026-09-25\n\n## [0.2.0] - 2026-09-26\n\nBody.\n";
    expect(() => extractReleaseNotes(changelog, "0.1.0")).toThrow(ReleaseNotesError);
  });

  test("throws on adjacent duplicate sections", () => {
    const changelog = `# Changelog\n\n## [0.1.0] - 2026-09-25\n\nFirst.\n\n## [0.1.0] - 2026-09-25\n\nSecond.\n`;
    expect(() => extractReleaseNotes(changelog, "0.1.0")).toThrow(/duplicate/);
  });

  test("throws on duplicates separated by another release", () => {
    const changelog = `# Changelog\n\n## [0.1.0] - 2026-09-25\n\nFirst.\n\n## [0.2.0] - 2026-09-26\n\nMiddle.\n\n## [0.1.0] - 2026-09-25\n\nSecond.\n`;
    expect(() => extractReleaseNotes(changelog, "0.1.0")).toThrow(/duplicate/);
  });
});
