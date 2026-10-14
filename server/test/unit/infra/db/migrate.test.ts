import { describe, expect, it } from "vitest";
import { renderMigration, versionAtLeast } from "../../../../src/infra/db/migrate.js";
import { ConfigError } from "../../../../src/domain/errors.js";

describe("renderMigration", () => {
  it("substitutes EMBEDDING_DIMENSIONS", () => {
    const rendered = renderMigration("CREATE TABLE t (embedding vector(${EMBEDDING_DIMENSIONS}));", { EMBEDDING_DIMENSIONS: 1536 });
    expect(rendered).toBe("CREATE TABLE t (embedding vector(1536));");
  });

  it("throws ConfigError on an unknown placeholder", () => {
    expect(() => renderMigration("${SOMETHING_ELSE}", { EMBEDDING_DIMENSIONS: 10 })).toThrow(ConfigError);
  });

  it("throws ConfigError on a non-positive dimension", () => {
    expect(() => renderMigration("${EMBEDDING_DIMENSIONS}", { EMBEDDING_DIMENSIONS: 0 })).toThrow(ConfigError);
    expect(() => renderMigration("${EMBEDDING_DIMENSIONS}", { EMBEDDING_DIMENSIONS: 1.5 })).toThrow(ConfigError);
  });
});

describe("versionAtLeast", () => {
  it("compares semantic versions correctly", () => {
    expect(versionAtLeast("0.8.0", [0, 8, 0])).toBe(true);
    expect(versionAtLeast("0.8.1", [0, 8, 0])).toBe(true);
    expect(versionAtLeast("0.9.0", [0, 8, 0])).toBe(true);
    expect(versionAtLeast("1.0.0", [0, 8, 0])).toBe(true);
    expect(versionAtLeast("0.7.4", [0, 8, 0])).toBe(false);
    expect(versionAtLeast("0.7.99", [0, 8, 0])).toBe(false);
  });
});
