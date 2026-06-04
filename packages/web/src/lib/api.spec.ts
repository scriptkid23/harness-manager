import { describe, it, expect, vi, afterEach } from "vitest";
import { listRepos, repoFeatures } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("listRepos calls /repos and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "r1", name: "demo", path: "/x" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const repos = await listRepos();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/repos"), expect.anything());
    expect(repos[0]?.name).toBe("demo");
  });

  it("repoFeatures hits the right path", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await repoFeatures("r1");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/repos/r1/features"), expect.anything());
  });
});
