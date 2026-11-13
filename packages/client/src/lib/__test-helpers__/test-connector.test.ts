import { describe, expect, test } from "bun:test";

import type { EngineConnector } from "../connection-manager/connector.types.js";
import { createTestConnector } from "./test-connector.js";

describe("createTestConnector defaults", () => {
  test("provides every EngineConnector member", async () => {
    const full: Required<EngineConnector> = createTestConnector();

    expect(full.capabilities).toEqual({
      voice: false,
      streaming: false,
      stateful: false,
    });
    await expect(full.connect("session" as never)).resolves.toBeUndefined();
    await expect(full.disconnect()).resolves.toBeUndefined();
    await expect(
      full.addAssistantMessage({} as never),
    ).resolves.toBeUndefined();
    await expect(full.getHistory("session" as never)).resolves.toEqual([]);
    await expect(full.sendAgentInput({} as never)).resolves.toBeUndefined();
  });

  test("subscribe and onAgentEvent return callable unsubscribes", () => {
    const connector = createTestConnector();

    expect(() => connector.subscribe(() => {})()).not.toThrow();
    expect(() => connector.onAgentEvent(() => {})()).not.toThrow();
  });

  test("process rejects naming process as not stubbed", async () => {
    await expect(createTestConnector().process({} as never)).rejects.toThrow(
      /process/,
    );
  });
});

describe("createTestConnector overrides", () => {
  test("overrides win over defaults", async () => {
    const connector = createTestConnector({
      capabilities: { voice: true, streaming: true, stateful: true },
      sendAgentInput: () => Promise.reject(new Error("custom")),
    });

    expect(connector.capabilities.voice).toBe(true);
    await expect(connector.sendAgentInput({} as never)).rejects.toThrow(
      "custom",
    );
    await expect(connector.getHistory("session" as never)).resolves.toEqual([]);
  });
});
