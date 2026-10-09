import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  convertFileSrc: (p: string) => p,
  invoke: vi.fn(),
}));
import { api, bytes } from "./api";
describe("browser boundary and size labels", () => {
  it("never silently supplies demonstration data outside desktop", async () => {
    await expect(api("images")).rejects.toThrow("桌面应用");
  });
  it("formats image sizes consistently", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1024)).toBe("1.0 KB");
    expect(bytes(1024 ** 3)).toBe("1.00 GB");
  });
});
