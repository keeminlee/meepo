type GenericRecord = Record<string, unknown>;

type InteractionLike = {
  id?: string;
  type?: unknown;
  token?: string;
  applicationId?: string;
  customId?: string;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  isStringSelectMenu?: () => boolean;
  isModalSubmit?: () => boolean;
  isButton?: () => boolean;
  client?: {
    application?: {
      id?: string;
    } | null;
  } | null;
};

export function getInteractionSurface(interaction: InteractionLike | null | undefined): string {
  if (interaction?.isModalSubmit?.()) return "modal_submit";
  if (interaction?.isStringSelectMenu?.()) return "string_select";
  if (interaction?.isButton?.()) return "button";
  if (interaction?.isChatInputCommand?.()) return "slash_command";
  return `interaction_type_${String(interaction?.type ?? "unknown")}`;
}

export function getInteractionCallDiagnostics(interaction: InteractionLike | null | undefined): GenericRecord {
  const token = typeof interaction?.token === "string" ? interaction.token : "";
  const appId = typeof interaction?.applicationId === "string"
    ? interaction.applicationId
    : interaction?.client?.application?.id;

  return {
    interaction_id: interaction?.id,
    interaction_surface: getInteractionSurface(interaction),
    interaction_type_raw: String(interaction?.type ?? "unknown"),
    custom_id: typeof interaction?.customId === "string" ? interaction.customId : undefined,
    deferred: Boolean(interaction?.deferred),
    replied: Boolean(interaction?.replied),
    is_chat_input_command: Boolean(interaction?.isChatInputCommand?.()),
    is_string_select_menu: Boolean(interaction?.isStringSelectMenu?.()),
    is_modal_submit: Boolean(interaction?.isModalSubmit?.()),
    is_button: Boolean(interaction?.isButton?.()),
    has_interaction_token: token.length > 0,
    interaction_token_length: token.length,
    has_application_id: typeof appId === "string" && appId.length > 0,
    app_id_source: typeof interaction?.applicationId === "string"
      ? "interaction.applicationId"
      : typeof interaction?.client?.application?.id === "string"
        ? "interaction.client.application.id"
        : "missing",
  };
}

export function getPayloadDiagnostics(payload: unknown): GenericRecord {
  const obj = (payload && typeof payload === "object") ? payload as Record<string, unknown> : null;
  const content = typeof obj?.content === "string" ? obj.content : "";
  const components = Array.isArray(obj?.components) ? obj.components : [];

  return {
    has_content: content.trim().length > 0,
    content_length: content.length,
    has_components: components.length > 0,
    components_count: components.length,
    is_ephemeral: typeof obj?.ephemeral === "boolean" ? obj.ephemeral : null,
    modal_fields_present: Boolean(obj?.customId || obj?.modal || obj?.fields),
  };
}

function safeClone(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => safeClone(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 25);
    for (const [key, nested] of entries) {
      if (typeof nested === "string" && /token|authorization|secret|api[_-]?key/i.test(key)) {
        out[key] = "<redacted>";
      } else {
        out[key] = safeClone(nested);
      }
    }
    return out;
  }
  return String(value);
}

export function serializeInteractionError(error: unknown): GenericRecord {
  const err = error as Record<string, unknown> | null;
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  return {
    error_name: error instanceof Error ? error.name : typeof err?.name === "string" ? err.name : typeof error,
    error_message: message,
    error_code: err?.code,
    error_status: err?.status,
    error_stack: error instanceof Error ? error.stack : typeof err?.stack === "string" ? err.stack : undefined,
    discord_rest_method: err?.method,
    discord_rest_path: err?.path,
    discord_rest_url: err?.url,
    discord_request_body: safeClone(err?.requestBody),
    discord_raw_error: safeClone(err?.rawError),
    discord_errors: safeClone(err?.errors),
    is_interaction_already_replied:
      normalizedMessage.includes("already been acknowledged")
      || normalizedMessage.includes("interactionalreadyreplied"),
    is_unknown_interaction: normalizedMessage.includes("unknown interaction"),
    is_invalid_webhook_token: normalizedMessage.includes("invalid webhook token"),
    is_interaction_not_replied: normalizedMessage.includes("not been sent or deferred"),
  };
}

export function shouldRetryAlternateResponsePath(error: unknown): boolean {
  const details = serializeInteractionError(error);
  return Boolean(
    details.is_interaction_already_replied
    || details.is_interaction_not_replied
    || details.is_unknown_interaction
    || details.is_invalid_webhook_token
  );
}
