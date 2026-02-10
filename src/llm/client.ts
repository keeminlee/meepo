import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
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
}): Promise<string> {
  const client = getOpenAIClient();
  
  // Read from env with fallbacks to hardcoded defaults
  const model = opts.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  const temperature = opts.temperature ?? Number(process.env.LLM_TEMPERATURE ?? "0.3");
  const maxTokens = opts.maxTokens ?? Number(process.env.LLM_MAX_TOKENS ?? "200");

  try {
    const response = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
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
