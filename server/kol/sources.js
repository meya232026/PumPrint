// Where posts come from.
//   X profiles   twitterapi.io (TWITTERAPI_IO_KEY) or the official X API (X_BEARER_TOKEN)
//   X post link  X's public oEmbed endpoint, no key needed
//   Telegram     the public channel preview at t.me/s/<channel>, no key needed

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../../vendor/kolibri/extension/shared/extract.js');
const TG = require('../../vendor/kolibri/extension/shared/telegram-preview.js');
const H = require('../../vendor/kolibri/extension/shared/minihtml.js');

export const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const DAY = 86400000;

/** Parse what someone typed: a profile, a post link, a channel. */
export function parseQuery(raw, platformHint) {
  let s = String(raw || '').trim();
  const status = /(?:^|\/\/|\.|^)(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i.exec(s);
  if (status) return { platform: 'x', handle: status[1], postId: status[2] };
  let platform = platformHint === 'tg' || platformHint === 'x' ? platformHint : null;
  if (/(^|\/\/|\.)(x|twitter)\.com\//i.test(s)) platform = 'x';
  else if (/(^|\/\/)(t|telegram)\.(me|dog)\//i.test(s)) platform = 'tg';
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.|mobile\.)/i, '');
  s = s.replace(/^(t\.me|telegram\.me|telegram\.dog)\/(s\/)?/i, '').replace(/^(x\.com|twitter\.com)\//i, '');
  s = s.replace(/^@/, '').split(/[/?#\s]/)[0];
  return { platform: platform || 'x', handle: s, postId: null };
}

function tweetPost(t, handle) {
  const links = ((t.entities && t.entities.urls) || []).map((u) => u.expanded_url || u.url).filter(Boolean);
  const postedAt = X.snowflakeToMs(String(t.id)) || Date.parse(t.createdAt || t.created_at);
  return { postId: String(t.id), postedAt, url: `https://x.com/${handle}/status/${t.id}`, text: t.text || '', links };
}

/** Recent posts of an X account. Retweets are skipped: those are someone else's calls. */
export async function readXProfile(handle, { provider, key, net, sinceMs, maxPages = 5, knownIds = new Set() }) {
  if (!X_HANDLE.test(handle)) throw Object.assign(new Error('invalid handle'), { status: 400 });
  const posts = [];
  let author = { platform: 'x', handle };
  if (provider === 'twitterapi') {
    let cursor = '';
    for (let page = 0; page < maxPages; page++) {
      const url = `https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}&includeReplies=false&cursor=${encodeURIComponent(cursor)}`;
      const res = await net.fetchJson(url, { headers: { 'X-API-Key': key } });
      if (res && res.status && res.status !== 'success') throw new Error(res.msg || res.message || 'twitterapi.io error');
      const tweets = (res && res.data && res.data.tweets) || (res && res.tweets) || [];
      if (page === 0 && !tweets.length && !(res && res.data)) throw Object.assign(new Error('user not found'), { status: 404 });
      let older = false;
      let allKnown = tweets.length > 0;
      for (const t of tweets) {
        if (t.author && page === 0 && author.handle === handle) {
          author = { platform: 'x', handle: t.author.userName || handle, name: t.author.name || handle, avatar: t.author.profilePicture || null };
        }
        if (t.retweeted_tweet) continue;
        const p = tweetPost(t, author.handle);
        if (p.postedAt < sinceMs) {
          older = true;
          continue;
        }
        if (!knownIds.has(p.postId)) allKnown = false;
        posts.push(p);
      }
      cursor = (res && res.next_cursor) || '';
      if (!(res && res.has_next_page) || !cursor || older || (knownIds.size && allKnown)) break;
    }
    return { author, posts };
  }
  if (provider === 'xapi') {
    const auth = { headers: { Authorization: `Bearer ${key}` } };
    const user = await net.fetchJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=profile_image_url,name`, auth);
    if (!user || !user.data) throw Object.assign(new Error('user not found'), { status: 404 });
    author = { platform: 'x', handle: user.data.username, name: user.data.name, avatar: user.data.profile_image_url || null };
    const since = new Date(sinceMs).toISOString();
    let token = null;
    for (let page = 0; page < maxPages; page++) {
      const q = `max_results=100&exclude=retweets&tweet.fields=created_at,entities&start_time=${encodeURIComponent(since)}${token ? `&pagination_token=${token}` : ''}`;
      const res = await net.fetchJson(`https://api.x.com/2/users/${user.data.id}/tweets?${q}`, auth);
      let allKnown = true;
      for (const t of (res && res.data) || []) {
        const p = tweetPost(t, author.handle);
        if (!knownIds.has(p.postId)) allKnown = false;
        posts.push(p);
      }
      token = res && res.meta && res.meta.next_token;
      if (!token || (knownIds.size && allKnown)) break;
    }
    return { author, posts };
  }
  throw Object.assign(new Error('no X data source'), { status: 501, code: 'x_unavailable' });
}

/** One X post through the public oEmbed endpoint (no key). The author is whoever X reports. */
export async function readXPost(handle, postId, { net }) {
  const user = X_HANDLE.test(handle || '') ? handle : 'i';
  const postUrl = `https://twitter.com/${user}/status/${postId}`;
  const json = await net.fetchJson(`https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}&omit_script=true&dnt=true&hide_thread=true`);
  const m = /(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\b/i.exec(String(json && json.author_url));
  if (!m) throw Object.assign(new Error('post not found'), { status: 404 });
  const doc = H.parse(json.html || '');
  const p = H.find(doc, H.byTag('p'));
  const text = p ? H.text(p) : '';
  const links = p ? H.findAll(p, H.byTag('a')).map((a) => a.attrs.href).filter(Boolean) : [];
  const postedAt = X.snowflakeToMs(String(postId));
  if (!postedAt) throw Object.assign(new Error('bad post id'), { status: 400 });
  return {
    author: { platform: 'x', handle: m[1], name: json.author_name || m[1] },
    posts: [{ postId: String(postId), postedAt, url: `https://x.com/${m[1]}/status/${postId}`, text, links }],
  };
}

/** Public Telegram channel history from t.me/s. */
export async function readTelegram(handle, { net, sinceMs, maxPages = 30, knownIds = new Set() }) {
  if (!TG.isValidUsername(handle)) throw Object.assign(new Error('invalid channel username'), { status: 400 });
  let author = { platform: 'tg', handle };
  const posts = [];
  let before = null;
  const firstRun = knownIds.size === 0;
  for (let page = 0; page < maxPages; page++) {
    const parsed = TG.parseChannelPage(await net.fetchText(TG.pageUrl(handle, before)), handle);
    if (!parsed.ok) {
      if (page === 0) throw Object.assign(new Error('channel has no public preview'), { status: 404 });
      break;
    }
    if (page === 0 && parsed.channel) {
      author = { platform: 'tg', handle: parsed.channel.username || handle, name: parsed.channel.title, avatar: parsed.channel.avatar };
    }
    for (const post of parsed.posts) {
      if (post.postedAt < sinceMs) continue;
      posts.push({ postId: String(post.id), postedAt: post.postedAt, url: post.url, text: post.text, links: post.links });
    }
    const allKnown = parsed.posts.length > 0 && parsed.posts.every((x) => knownIds.has(String(x.id)));
    if (!parsed.hasMore || !parsed.posts.length || parsed.posts[0].postedAt < sinceMs || (!firstRun && allKnown)) break;
    before = parsed.minId;
  }
  return { author, posts };
}

export const historyStart = (days, now = Date.now()) => now - days * DAY;
