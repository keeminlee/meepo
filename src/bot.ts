import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { registerHandlers } from "./commands/index.js";
import { getActiveMeepo } from "./meepo/state.js";
import { appendLedgerEntry, getRecentLedgerText } from "./ledger/ledger.js";
import { isLatchActive, setLatch } from "./latch/latch.js";
import { isAddressed } from "./meepo/triggers.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

registerHandlers(client);

client.once("ready", () => {
  console.log("Meepo online as " + (client.user?.tag ?? "<unknown>"));
});

client.on("messageCreate", async (message: any) => {
  try {
    console.log(
      "MSG",
      message.channelId,
      message.author.username,
      JSON.stringify(message.content)
    );
    if (!message.guildId) return;
    if (message.author?.bot) return;

    const active = getActiveMeepo(message.guildId);
    if (!active) return;

    const content = (message.content ?? "").toString();
    if (!content.trim()) return;

    // 1) LEDGER: log every message in the guild that Meepo can see
    appendLedgerEntry({
      guild_id: message.guildId,
      channel_id: message.channelId,
      message_id: message.id,
      author_id: message.author.id,
      author_name: message.member?.displayName ?? message.author.username ?? message.author.id,
      timestamp_ms: message.createdTimestamp ?? Date.now(),
      content,
    });

    // 2) SPEECH: only respond in Meepo's bound channel
    if (message.channelId !== active.channel_id) return;

    // 3) Address/latch logic (only relevant in bound channel)
    const prefix = process.env.BOT_PREFIX ?? "meepo:";
    const latchSeconds = Number(process.env.LATCH_SECONDS ?? "500");

    const mentionedMeepo = message.mentions?.users?.has(client.user!.id) ?? false;
    const addressed = mentionedMeepo || isAddressed(content, prefix);
    const latchActive = isLatchActive(message.guildId, message.channelId);

    console.log("ADDR?", addressed, "LATCH?", latchActive);
    if (!addressed && !latchActive) return;

    // Extend latch once we respond
    setLatch(message.guildId, message.channelId, latchSeconds);

    // Reply
    await message.reply("meep");

  } catch (err) {
    console.error("messageCreate error", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
