import type { Bot, Chat, Message } from "./types";

/** One pass over the transcript, rather than copying it for every sidebar row and comparison. */
export function conversationIndex(messages: Message[]) {
  const index = new Map<string, { last: Message; incomingAt: number }>();
  for (const m of messages) {
    const previous = index.get(m.chatId);
    index.set(m.chatId, {
      last: !previous || m.at >= previous.last.at ? m : previous.last,
      incomingAt: Math.max(previous?.incomingAt ?? 0, m.role !== "user" ? m.at : 0),
    });
  }
  return index;
}

export function conversationUnread(chat: Chat, incomingAt = 0) {
  return chat.unread === true || incomingAt > (chat.readAt ?? 0);
}

/** Manual positions stay put when messages arrive; unseen conversations append to the list. */
export function orderConversations(chats: Chat[], index: ReturnType<typeof conversationIndex>, order?: string[]) {
  const ranks = new Map(order?.map((id, position) => [id, position]));
  return [...chats].sort((a, b) => {
    if (order) {
      const difference = (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length);
      if (difference) return difference;
    }
    return (index.get(b.id)?.last.at ?? b.createdAt) - (index.get(a.id)?.last.at ?? a.createdAt) || a.id.localeCompare(b.id);
  });
}

/** Move across visible neighbours without dropping hidden or filtered cards from the saved order. */
export function moveConversation(order: string[], from: string, to: string) {
  const next = [...order], source = next.indexOf(from), target = next.indexOf(to);
  if (source < 0 || target < 0 || source === target) return next;
  next.splice(source, 1);
  next.splice(target, 0, from);
  return next;
}

/** IDs also work as mentions, so renaming a person doesn't invalidate saved instructions. */
export function mentionedBots(text: string, bots: Bot[]) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return bots.filter(b => [b.name, b.id].some(name => new RegExp(`(^|[^\\w])@${escape(name)}(?=$|[^\\w-])`, "i").test(text)));
}

export const leadsTeam = (bot: Bot) => bot.isMain || bot.teamRole === "operations";
