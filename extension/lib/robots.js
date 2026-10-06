// robots.txt parsing and matching, following RFC 9309 and Google's documented behaviour:
// - the most specific matching group for the crawler wins, falling back to "*"
// - groups for the same agent are merged
// - the longest matching rule wins; on a tie, Allow wins
// - "*" matches any sequence, a trailing "$" anchors the end

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let collectingAgents = false;

  for (const raw of String(text ?? '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (key === 'allow' || key === 'disallow') {
      collectingAgents = false;
      if (current) current.rules.push({ type: key, path: value, line });
    } else if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else {
      // crawl-delay and other group members end the user-agent run
      collectingAgents = false;
    }
  }
  return { groups, sitemaps };
}

function encodeNonAscii(path) {
  return path.replace(/[^\x00-\x7F]/g, (c) => encodeURIComponent(c));
}

function escapeRegExp(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesRule(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = encodeNonAscii(anchored ? pattern.slice(0, -1) : pattern);
  const source = '^' + body.split('*').map(escapeRegExp).join('.*') + (anchored ? '$' : '');
  return new RegExp(source).test(path);
}

export function groupsFor(robots, agent = 'googlebot') {
  const name = agent.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.includes(name));
  if (specific.length) return { agent: name, groups: specific };
  return { agent: '*', groups: robots.groups.filter((g) => g.agents.includes('*')) };
}

export function checkUrl(robots, url, agent = 'googlebot') {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return { allowed: true, rule: null, group: null };
  const path = u.pathname + u.search;
  const { agent: group, groups } = groupsFor(robots, agent);
  let best = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!rule.path) continue; // an empty Disallow allows everything
    if (!matchesRule(rule.path, path)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.type === 'allow' && best.type === 'disallow')
    ) {
      best = rule;
    }
  }
  return { allowed: !best || best.type === 'allow', rule: best, group: groups.length ? group : null };
}
