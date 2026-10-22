import { describe, expect, it } from "vitest";
import { normalizeDoi } from "../../src/core/doi";

describe("normalizeDoi", () => {
  it("lower-cases a bare DOI", () => {
    expect(normalizeDoi("10.1002/SMJ.70136")).toBe("10.1002/smj.70136");
  });

  it("strips doi.org URLs and doi: prefixes", () => {
    expect(normalizeDoi("https://doi.org/10.1080/00076791.2026.1")).toBe(
      "10.1080/00076791.2026.1",
    );
    expect(normalizeDoi("http://dx.doi.org/10.1016/j.lrp.2026.102500")).toBe(
      "10.1016/j.lrp.2026.102500",
    );
    expect(normalizeDoi("doi:10.1002/smj.70129")).toBe("10.1002/smj.70129");
  });

  it("decodes URL-encoded DOIs", () => {
    expect(normalizeDoi("https://doi.org/10.1002%2Fsmj.70129")).toBe(
      "10.1002/smj.70129",
    );
  });

  it("drops trailing punctuation picked up from text", () => {
    expect(normalizeDoi("see 10.1002/smj.70129.")).toBe("10.1002/smj.70129");
  });

  it("returns null when there is no DOI", () => {
    expect(normalizeDoi("")).toBeNull();
    expect(normalizeDoi(undefined)).toBeNull();
    expect(
      normalizeDoi("https://journals.sagepub.com/toc/oss/current"),
    ).toBeNull();
  });
});
