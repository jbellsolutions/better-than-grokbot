/**
 * How a bot's answer reads while it's still being written (the web chat and Slack both use this).
 * The "Options:" line becomes buttons once the answer is saved (tidyAnswer in lib/server/style.ts), so
 * it's held back, and so is a last line that may still be turning into one ("Opt…").
 */
export function provisionalText(raw: string) {
  const lines = raw.split("\n").filter((line) => !/^\s*\**options\**\s*:/i.test(line));
  const last = lines.at(-1)?.trim().replace(/^\*+/, "").toLowerCase() ?? "";
  if (last && "options:".startsWith(last)) lines.pop();
  return lines.join("\n").replace(/\s+$/, "");
}

/** Words for a tool a bot is using, for its chip ("Searching LinkedIn…"). Never its arguments' contents. */
export function toolLabel(name: string, args: Record<string, unknown> = {}, names: (botId: string) => string | undefined = () => undefined) {
  const action = typeof args.action === "string" ? args.action : "";
  if (name === "use_app" && action) return appActionLabel(action);
  const fixed: Record<string, string> = {
    find_app_actions: "Finding the right app action",
    remember: "Saving to memory",
    recall: "Checking memory",
    watch: "Setting up a watch",
    stop_watch: "Stopping a watch",
    check_email: "Checking email",
    read_email: "Reading an email",
    send_email: "Writing an email",
    reply_email: "Writing a reply",
    text_me: "Texting you",
    manage_task: "Checking a task",
    create_bot: "Adding a teammate",
    delete_bot: "Removing a teammate",
    list_agents: "Checking the team",
    start_task: "Starting a task",
    hand_off: "Handing it off",
    schedule: "Scheduling it",
    manage_routine: "Changing a routine",
    make_page: "Making a page",
    react: "Reacting",
  };
  if (name === "ask_teammate") {
    const who = typeof args.bot_id === "string" ? names(args.bot_id) : undefined;
    return who ? `Asking ${who}` : "Asking a teammate";
  }
  if (name === "hand_off" && typeof args.bot_id === "string" && names(args.bot_id)) return `Handing it to ${names(args.bot_id)}`;
  if (fixed[name]) return fixed[name];
  const plain = name.replace(/^custom_/, "").replace(/^(screen|browser)__/, "").replace(/[_.]+/g, " ").trim();
  return plain ? `Using ${plain}` : "Using a tool";
}

/** "LINKEDIN_SEARCH_PEOPLE" → "LinkedIn: search people". */
export function appActionLabel(slug: string) {
  const [app, ...rest] = slug.toLowerCase().split("_");
  const BRANDS: Record<string, string> = { linkedin: "LinkedIn", gmail: "Gmail", googlecalendar: "Google Calendar", googledrive: "Google Drive", googlesheets: "Google Sheets", googledocs: "Google Docs", hubspot: "HubSpot", slackbot: "Slack", slack: "Slack", github: "GitHub", notion: "Notion", outlook: "Outlook", salesforce: "Salesforce", airtable: "Airtable", linear: "Linear" };
  const name = BRANDS[app] ?? (app ? app[0].toUpperCase() + app.slice(1) : "App");
  return rest.length ? `${name}: ${rest.join(" ")}` : name;
}

const clip = (s: string, max = 300) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const SECRET = /(pass(word)?|secret|token|api[_ ]?key|authorization|cookie|otp|2fa|pin|ssn|card[_ ]?number|cvv)/i;

/**
 * An approval's detail ("to: …\nsubject: …") as up to 10 rows, with anything secret-looking hidden.
 * The app's approval card, the Slack card and the AG-UI interrupt all show these.
 */
export function approvalFields(detail: string) {
  const rows: { label: string; value: string }[] = [];
  for (const line of detail.split("\n")) {
    const m = /^([^:\n]{1,60}):\s?(.*)$/.exec(line);
    if (m && rows.length < 10) rows.push({ label: clip(m[1].trim(), 60), value: SECRET.test(m[1]) ? "••••••" : clip(m[2]) });
    else if (rows.length) rows[rows.length - 1].value = clip(`${rows[rows.length - 1].value}\n${line}`);
    else rows.push({ label: "Details", value: clip(line) });
  }
  return rows.filter((r) => r.value.trim());
}
