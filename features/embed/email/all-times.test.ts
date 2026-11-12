import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { allTimesHelp, possessive, readShowAllTimes, SHOW_ALL_TIMES_KEY, writeShowAllTimes } from "./all-times";
import { AllTimesSwitch } from "./all-times-fields";

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}
const text = (node: ReactNode): string => {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement(node)) return "";
  return text((node.props as { children?: ReactNode }).children);
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("remembered switch", () => {
  it("is off by default, on the server and when storage fails", () => {
    expect(readShowAllTimes(null)).toBe(false);
    expect(readShowAllTimes(memoryStorage())).toBe(false);
    expect(readShowAllTimes(memoryStorage({ [SHOW_ALL_TIMES_KEY]: "yes" }))).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readShowAllTimes(broken)).toBe(false);
    expect(() => writeShowAllTimes(broken, true)).not.toThrow();
    expect(() => writeShowAllTimes(null, true)).not.toThrow();
  });

  it("remembers on and off per browser", () => {
    const storage = memoryStorage();
    writeShowAllTimes(storage, true);
    expect(readShowAllTimes(storage)).toBe(true);
    writeShowAllTimes(storage, false);
    expect(readShowAllTimes(storage)).toBe(false);
  });
});

describe("switch wording", () => {
  it("says what off and on mean, naming the host", () => {
    expect(allTimesHelp(false, "Tré", true)).toEqual({ help: "The client can only book the times you picked.", warning: null });
    expect(allTimesHelp(true, "Tré", false)).toEqual({ help: "Adds a See all available times link. The client can pick any open time on Tré's calendar.", warning: null });
    expect(allTimesHelp(true, "you", false).help).toBe("Adds a See all available times link. The client can pick any open time on your calendar.");
  });

  it("warns before showing a private host's open times", () => {
    expect(allTimesHelp(true, "Tré", true).warning).toBe("Tré keeps their calendar private. Turning this on shows this client all of their open times.");
    expect(allTimesHelp(true, "you", true).warning).toBe("You keep your calendar private. Turning this on shows this client all of your open times.");
  });

  it("uses plain possessives", () => {
    expect(possessive("you")).toBe("your");
    expect(possessive("Chelsea")).toBe("Chelsea's");
    expect(possessive(" ")).toBe("the host's");
  });

  it("has no em dashes", () => {
    for (const on of [true, false]) for (const p of [true, false]) {
      const { help, warning } = allTimesHelp(on, "Tré", p);
      expect(`${help}${warning ?? ""}`).not.toMatch(/\u2014/);
    }
  });
});

describe("AllTimesSwitch", () => {
  const props = { on: false, onChange: vi.fn(), hostLabel: "Tré", privateHost: true };

  it("is a labelled switch, off with the picked-times helper", () => {
    const rendered = nodes(AllTimesSwitch(props));
    const sw = rendered.find((p) => p.id === "email-all-times");
    expect(sw?.checked).toBe(false);
    expect(sw?.["aria-describedby"]).toBe("email-all-times-help");
    expect(rendered.find((p) => p.htmlFor === "email-all-times")?.children).toBe("Let the client see all available times");
    expect(rendered.find((p) => p.id === "email-all-times-help")?.children).toBe("The client can only book the times you picked.");
    (sw?.onCheckedChange as (v: boolean) => void)(true);
    expect(props.onChange).toHaveBeenCalledWith(true);
  });

  it("on for a private host, shows the warning and a slots error", () => {
    const tree = AllTimesSwitch({ ...props, on: true, error: "A picked time is no longer open" });
    const rendered = nodes(tree);
    expect(rendered.find((p) => p.id === "email-all-times")?.["aria-describedby"]).toBe("email-all-times-help email-all-times-warning email-all-times-error");
    expect(text(tree)).toContain("Tré keeps their calendar private.");
    expect(rendered.find((p) => p.role === "alert")?.children).toBe("A picked time is no longer open");
  });
});
