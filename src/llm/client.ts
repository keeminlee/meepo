import OpenAI from "openai";
import { cfg } from "../config/env.js";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = cfg.openai.apiKey;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured in .env");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export async function chat(opts: {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
}): Promise<string> {
  const client = getOpenAIClient();
  
  // Read from env with fallbacks to hardcoded defaults
  const model = opts.model ?? cfg.llm.model;
  const temperature = opts.temperature ?? cfg.llm.temperature;
  const maxTokens = opts.maxTokens ?? cfg.llm.maxTokens;

  try {
    const response = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      ...(opts.responseFormat === "json_object"
        ? { response_format: { type: "json_object" as const } }
        : {}),
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userMessage },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    return content;
  } catch (err: any) {
    console.error("OpenAI API error:", err.message ?? err);
    throw new Error("LLM request failed: " + (err.message ?? "unknown error"));
  }
}
