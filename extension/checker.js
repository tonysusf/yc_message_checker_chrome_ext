"use strict";
const YCChecker = {
  query: `query YC_MESSAGE_CHECKER {
    currentUser { slug }
    conversations { conversationPreviews {
      slug lastRead profile { user { name } }
      latestMessage { createdAt outgoing message }
    } }
  }`,
  csrfToken(html) {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    const tag = tags.find(value => /name=["']csrf-token["']/i.test(value));
    return tag?.match(/content=["']([^"']*)["']/i)?.[1]
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  },
  snapshot(result) {
    if (result.errors?.length) throw new Error("Startup School could not return messages. Check your sign-in or try again later.");
    const account = result.data?.currentUser?.slug;
    const previews = result.data?.conversations?.conversationPreviews;
    if (!account || !Array.isArray(previews)) throw new Error("Unexpected inbox response. Open Startup School to check your sign-in.");
    const unread = [];
    const conversations = [];
    for (const item of previews) {
      const latest = item.latestMessage;
      if (!latest) continue;
      if (!item.slug || typeof latest.outgoing !== "boolean" || !Number.isFinite(Date.parse(latest.createdAt))) {
        throw new Error("Startup School message format changed. The checker needs an update.");
      }
      const isUnread = !latest.outgoing && (!item.lastRead || Date.parse(item.lastRead) < Date.parse(latest.createdAt));
      conversations.push({ slug: item.slug, createdAt: latest.createdAt, outgoing: latest.outgoing,
        unread: isUnread, name: item.profile?.user?.name?.trim() || "Unknown founder",
        snippet: typeof latest.message === "string" ? latest.message.replace(/\s+/g, " ").trim().slice(0, 300) : "" });
      if (isUnread) {
        unread.push({ slug: item.slug, createdAt: latest.createdAt });
      }
    }
    conversations.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { account, unread, previews: { all: conversations.slice(0, 20),
      unread: conversations.filter(item => item.unread).slice(0, 20) } };
  }
};
if (typeof module !== "undefined") module.exports = YCChecker;
