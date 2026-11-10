import { describe, expect, it } from "vitest";
import { readChoice, restoreChoice, SCHEDULE_CHOICE_KEY, serializeChoice, writeChoice } from "./schedule-choice";

const principals = [
  { id: "self", types: [{ id: "intro" }] },
  { id: "team:charlie", types: [{ id: "demo" }, { id: "review" }] },
  { id: "team:empty", types: [] },
];

describe("remembered scheduling choice", () => {
  it("restores a host and meeting type that are still available", () => {
    expect(restoreChoice(serializeChoice({ principalId: "team:charlie", typeId: "review" }), principals)).toEqual({ principalId: "team:charlie", typeId: "review" });
  });

  it("keeps the host but drops a meeting type that is gone or belongs to someone else", () => {
    expect(restoreChoice(serializeChoice({ principalId: "team:charlie", typeId: "deleted" }), principals)).toEqual({ principalId: "team:charlie", typeId: null });
    expect(restoreChoice(serializeChoice({ principalId: "team:charlie", typeId: "intro" }), principals)).toEqual({ principalId: "team:charlie", typeId: null });
  });

  it("ignores unknown hosts, hosts without meeting types and junk", () => {
    for (const raw of [null, "", "not json", "[]", "null", '{"principalId":3}', serializeChoice({ principalId: "team:gone", typeId: "demo" }), serializeChoice({ principalId: "team:empty", typeId: null })]) {
      expect(restoreChoice(raw, principals), String(raw)).toBeNull();
    }
  });

  it("reads and writes through storage and survives storage errors or no storage (server)", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeChoice(storage, { principalId: "self", typeId: "intro" });
    expect(store.get(SCHEDULE_CHOICE_KEY)).toBe('{"principalId":"self","typeId":"intro"}');
    expect(readChoice(storage, principals)).toEqual({ principalId: "self", typeId: "intro" });

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readChoice(broken, principals)).toBeNull();
    expect(() => writeChoice(broken, { principalId: "self", typeId: null })).not.toThrow();
    expect(readChoice(null, principals)).toBeNull();
  });
});
