/** Shared vector arrow figures for Better than GrokBot's app, desktops and channel avatars.
 * Legacy IDs and picture filenames remain compatible with saved state and existing integrations.
 */

export type Mood = "idle" | "awake";

/** Legacy IDs stay attached to their conversations; every figure uses the fork's arrow mark. */
export const isMainBotId = (botId: string) => /^(boppy|sam|head-of-ops|better-than-grokbot)(-\d+)?$/.test(botId);
export function faceOf(botId: string): "open" | "happy" | "wink" {
  return isMainBotId(botId) ? "open" : "happy";
}

export function mascotMarkup(botId: string, color: string, opts: { mood?: Mood; accent?: boolean } = {}) {
  const main = isMainBotId(botId);
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : "#D5F85B";
  const background = main ? "#101513" : safeColor;
  const foreground = main && opts.accent !== false ? "#D5F85B" : main ? "#FFFFFF" : "#101513";
  return `<rect x="1" y="1" width="38" height="38" rx="9" fill="${background}"/>` +
    `<path d="M11 29 28 12M14 12h14v14" fill="none" stroke="${foreground}" stroke-width="4.3" stroke-linecap="square"/>` +
    (opts.mood === "awake" ? `<circle cx="10" cy="10" r="2" fill="${foreground}"/>` : "");
}

/**
 * The bots' pictures, rendered ahead of time (scripts/render-mascots.mjs) into edge/public/mascot,
 * which Bops Cloud and the self-hosted front door (edge/) serve at /mascot/<name>.png and .jpg for
 * Slack, Telegram and Discord: the main bot, a blob in each of these colors (new bots' colors and the
 * seed bots'), and the seed bots with shapes of their own.
 */
export const PICTURE_COLORS = ["#FF9F43", "#2EC4B6", "#A78BFA", "#F87171", "#60A5FA", "#34D399", "#E9FF3B", "#FF6FB5", "#47C46B", "#5B8CFF"];
export const PICTURE_SHAPES: Record<string, string> = { penny: "#FF6FB5", otto: "#E9FF3B", rook: "#47C46B" };

/** A bot's rendered picture ("blob-2EC4B6"), or null when its color has none (it shows the Bops logo instead). */
export function pictureName(b: { id: string; color: string; isMain: boolean }): string | null {
  if (b.isMain) return "main-0A0A0A";
  const hex = b.color.replace("#", "").toUpperCase();
  if (PICTURE_SHAPES[b.id]?.slice(1).toUpperCase() === hex) return `${b.id}-${hex}`;
  return PICTURE_COLORS.some((c) => c.slice(1).toUpperCase() === hex) ? `blob-${hex}` : null;
}

/** A whole SVG document for a bot's mascot, for pages outside the app. */
export const mascotSvg = (botId: string, color: string, size: number, mood: Mood = "idle") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}">${mascotMarkup(botId, color, { mood })}</svg>`;
