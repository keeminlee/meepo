export type TextReplyPolicyDecision = {
  allowed: boolean;
  reason: "enabled" | "prod_text_reply_disabled";
};

export function shouldAllowConversationalTextOutput(args: {
  nodeEnv: string | undefined;
  isDevUser: boolean;
}): TextReplyPolicyDecision {
  const isProd = (args.nodeEnv ?? "").toLowerCase() === "production";
  if (isProd && !args.isDevUser) {
    return { allowed: false, reason: "prod_text_reply_disabled" };
  }
  return { allowed: true, reason: "enabled" };
}
