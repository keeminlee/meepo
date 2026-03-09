import { describe, expect, test } from "vitest";
import { shouldAllowConversationalTextOutput } from "../runtime/textReplyPolicy.js";

describe("text reply policy", () => {
  test("disables conversational text output in production for non-dev users", () => {
    expect(
      shouldAllowConversationalTextOutput({
        nodeEnv: "production",
        isDevUser: false,
      })
    ).toEqual({
      allowed: false,
      reason: "prod_text_reply_disabled",
    });
  });

  test("allows conversational text output in production for explicit dev users", () => {
    expect(
      shouldAllowConversationalTextOutput({
        nodeEnv: "production",
        isDevUser: true,
      })
    ).toEqual({
      allowed: true,
      reason: "enabled",
    });
  });

  test("allows conversational text output outside production", () => {
    expect(
      shouldAllowConversationalTextOutput({
        nodeEnv: "development",
        isDevUser: false,
      })
    ).toEqual({
      allowed: true,
      reason: "enabled",
    });
  });
});
