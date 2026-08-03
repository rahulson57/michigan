/**
 * michigan seed — idempotent. `npm run seed` wipes and repopulates.
 *
 * Everything is generated locally: avatars, profile covers, article covers and
 * inline figures are deterministic SVGs written into server/uploads/. No
 * network access required.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOADS_DIR } from './db.js';
import { hashPassword } from './auth.js';
import { slugify, deriveExcerpt, deriveReadingTime } from './routes/articles.js';

const DEMO_PASSWORD = 'password123';

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rand = mulberry32(20260802);

/* ------------------------------------------------------------------ *
 * Local SVG media generation
 * ------------------------------------------------------------------ */

// Cool, desaturated, lake-adjacent — tuned to sit quietly next to the
// design-system accent (--accent: #0e6b70) rather than compete with it.
// [shadow, midtone, highlight]
const PALETTES = [
  ['#0b2f34', '#17696b', '#e6f0ef'], // deep petrol
  ['#10233a', '#2f5f8f', '#e8eef6'], // lake at night
  ['#1b232b', '#4a5f6b', '#eceff1'], // slate
  ['#1c2a22', '#43705a', '#e9f1ec'], // moss
  ['#191d33', '#454f86', '#ebedf7'], // indigo
  ['#2f2119', '#8a5a44', '#f3ece7'], // clay — the one warm note
  ['#241a2b', '#5f4372', '#efeaf3'], // plum
  ['#14252b', '#38707c', '#e7f0f2'], // storm
];

function paletteFor(key) {
  return PALETTES[hashString(key) % PALETTES.length];
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function writeUpload(filename, contents) {
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), contents, 'utf8');
  return `/uploads/${filename}`;
}

function initialsOf(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function avatarSvg(name, key) {
  const [dark, mid, light] = paletteFor(key);
  const r = mulberry32(hashString(`avatar:${key}`));
  const angle = Math.floor(r() * 360);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="${esc(name)}">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${dark}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <circle cx="${Math.floor(60 + r() * 280)}" cy="${Math.floor(60 + r() * 280)}" r="${Math.floor(70 + r() * 90)}" fill="${light}" opacity="0.08"/>
  <circle cx="${Math.floor(60 + r() * 280)}" cy="${Math.floor(60 + r() * 280)}" r="${Math.floor(40 + r() * 70)}" fill="${light}" opacity="0.07"/>
  <text x="200" y="200" fill="${light}" font-family="Georgia, 'Iowan Old Style', serif" font-size="150" font-weight="500" text-anchor="middle" dominant-baseline="central" opacity="0.94">${esc(initialsOf(name))}</text>
</svg>
`;
}

function bandsSvg({ width, height, key, label, seedNote }) {
  const [dark, mid, light] = paletteFor(key);
  const r = mulberry32(hashString(`${seedNote}:${key}`));
  const angle = Math.floor(r() * 120) - 60;
  const bands = [];
  for (let i = 0; i < 7; i += 1) {
    const y = Math.floor(r() * height);
    const h = Math.floor(6 + r() * (height / 7));
    bands.push(
      `<rect x="0" y="${y}" width="${width}" height="${h}" fill="${light}" opacity="${(0.03 + r() * 0.05).toFixed(3)}"/>`,
    );
  }
  const orbs = [];
  for (let i = 0; i < 4; i += 1) {
    orbs.push(
      `<circle cx="${Math.floor(r() * width)}" cy="${Math.floor(r() * height)}" r="${Math.floor(height * (0.12 + r() * 0.35))}" fill="${light}" opacity="${(0.04 + r() * 0.05).toFixed(3)}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${dark}"/>
      <stop offset="55%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${dark}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  ${orbs.join('\n  ')}
  ${bands.join('\n  ')}
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * Content builder: tuples -> { html, json } (TipTap doc)
 * ------------------------------------------------------------------ */

const INLINE_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

function inlineNodes(text) {
  const nodes = [];
  let html = '';
  let last = 0;
  const src = String(text);
  INLINE_RE.lastIndex = 0;
  let m = INLINE_RE.exec(src);
  while (m) {
    if (m.index > last) {
      const plain = src.slice(last, m.index);
      nodes.push({ type: 'text', text: plain });
      html += esc(plain);
    }
    if (m[1] !== undefined) {
      nodes.push({ type: 'text', marks: [{ type: 'bold' }], text: m[1] });
      html += `<strong>${esc(m[1])}</strong>`;
    } else if (m[2] !== undefined) {
      nodes.push({ type: 'text', marks: [{ type: 'italic' }], text: m[2] });
      html += `<em>${esc(m[2])}</em>`;
    } else if (m[3] !== undefined) {
      nodes.push({ type: 'text', marks: [{ type: 'code' }], text: m[3] });
      html += `<code>${esc(m[3])}</code>`;
    } else {
      nodes.push({
        type: 'text',
        marks: [{ type: 'link', attrs: { href: m[5], target: '_blank' } }],
        text: m[4],
      });
      html += `<a href="${esc(m[5])}" target="_blank" rel="noopener noreferrer">${esc(m[4])}</a>`;
    }
    last = m.index + m[0].length;
    m = INLINE_RE.exec(src);
  }
  if (last < src.length) {
    const plain = src.slice(last);
    nodes.push({ type: 'text', text: plain });
    html += esc(plain);
  }
  return { nodes, html };
}

function paragraphNode(text) {
  const { nodes, html } = inlineNodes(text);
  return { node: { type: 'paragraph', content: nodes }, html: `<p>${html}</p>` };
}

function buildContent(blocks) {
  const content = [];
  const htmlParts = [];

  for (const block of blocks) {
    const [kind, ...rest] = block;

    if (kind === 'h2' || kind === 'h3') {
      const level = kind === 'h2' ? 2 : 3;
      const { nodes, html } = inlineNodes(rest[0]);
      content.push({ type: 'heading', attrs: { level }, content: nodes });
      htmlParts.push(`<h${level}>${html}</h${level}>`);
    } else if (kind === 'p') {
      const { node, html } = paragraphNode(rest[0]);
      content.push(node);
      htmlParts.push(html);
    } else if (kind === 'quote') {
      const { node, html } = paragraphNode(rest[0]);
      content.push({ type: 'blockquote', content: [node] });
      htmlParts.push(`<blockquote>${html}</blockquote>`);
    } else if (kind === 'ul') {
      const items = rest.map((t) => {
        const { node, html } = paragraphNode(t);
        return { node: { type: 'listItem', content: [node] }, html: `<li>${html}</li>` };
      });
      content.push({ type: 'bulletList', content: items.map((i) => i.node) });
      htmlParts.push(`<ul>${items.map((i) => i.html).join('')}</ul>`);
    } else if (kind === 'ol') {
      const items = rest.map((t) => {
        const { node, html } = paragraphNode(t);
        return { node: { type: 'listItem', content: [node] }, html: `<li>${html}</li>` };
      });
      content.push({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => i.node) });
      htmlParts.push(`<ol>${items.map((i) => i.html).join('')}</ol>`);
    } else if (kind === 'img') {
      const [src, alt] = rest;
      content.push({ type: 'image', attrs: { src, alt: alt || null, title: alt || null } });
      htmlParts.push(`<figure><img src="${esc(src)}" alt="${esc(alt || '')}" />${alt ? `<figcaption>${esc(alt)}</figcaption>` : ''}</figure>`);
    } else if (kind === 'hr') {
      content.push({ type: 'horizontalRule' });
      htmlParts.push('<hr />');
    } else if (kind === 'code') {
      const [language, code] = rest;
      content.push({
        type: 'codeBlock',
        attrs: { language: language || null },
        content: [{ type: 'text', text: code }],
      });
      htmlParts.push(`<pre><code class="language-${esc(language || 'text')}">${esc(code)}</code></pre>`);
    }
  }

  return { html: htmlParts.join('\n'), json: { type: 'doc', content } };
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

const USERS = [
  {
    username: 'mayaokonkwo',
    email: 'maya@michigan.dev',
    name: 'Maya Okonkwo',
    bio: 'Distributed systems engineer. I write about queues, failure, and the parts of infrastructure nobody puts on a slide.',
    twitter: 'mayabuildsit',
    github: 'mayaokonkwo',
    linkedin: 'mayaokonkwo',
    website: 'https://maya.systems',
  },
  {
    username: 'tobiaslind',
    email: 'tobias@michigan.dev',
    name: 'Tobias Lind',
    bio: 'Designer in Malmö. Type, grids, and interfaces that get out of the way. Previously at two newspapers and one very loud startup.',
    twitter: 'tobiassetstype',
    github: 'tlind',
    linkedin: 'tobiaslind',
    website: 'https://tobiaslind.se',
  },
  {
    username: 'priyaraman',
    email: 'priya@michigan.dev',
    name: 'Priya Raman',
    bio: 'Machine learning researcher. Currently obsessed with evaluation: how we measure models, and how those measurements quietly mislead us.',
    twitter: 'priya_evals',
    github: 'praman',
    linkedin: 'priyaraman',
    website: 'https://priyaraman.net',
  },
  {
    username: 'desmondhale',
    email: 'desmond@michigan.dev',
    name: 'Desmond Hale',
    bio: 'Essayist. Two books, a lot of discarded drafts. I write about writing, attention, and the slow work of making something true.',
    twitter: 'deshale',
    github: null,
    linkedin: 'desmondhale',
    website: 'https://desmondhale.com',
  },
  {
    username: 'luciamoreau',
    email: 'lucia@michigan.dev',
    name: 'Lucía Moreau',
    bio: 'Product lead. I have shipped enough roadmaps to distrust them. Writing about pricing, scope, and telling the truth about uncertainty.',
    twitter: 'luciaships',
    github: 'lmoreau',
    linkedin: 'luciamoreau',
    website: 'https://luciamoreau.co',
  },
  {
    username: 'kenjiwatanabe',
    email: 'kenji@michigan.dev',
    name: 'Kenji Watanabe',
    bio: 'SRE by trade, gardener by temperament. Reliability, on-call humaneness, and what a compost pile knows about steady state.',
    twitter: 'kenji_sre',
    github: 'kwatanabe',
    linkedin: 'kenjiwatanabe',
    website: 'https://slowops.dev',
  },
];

/* ------------------------------------------------------------------ *
 * Articles
 * ------------------------------------------------------------------ */

const ARTICLES = [
  /* ---------------------------- Maya ---------------------------- */
  {
    author: 'mayaokonkwo',
    title: 'The Queue Is the Product',
    subtitle: 'Every system you build is a promise about what happens when you are too slow.',
    tags: ['distributed-systems', 'architecture', 'backpressure'],
    body: [
      ['p', 'The first distributed system I helped operate had a queue in the middle of it, and for about eighteen months I thought of that queue as plumbing. It moved messages from one place to another. It had a dashboard nobody looked at. It was, in the org chart of my attention, infrastructure.'],
      ['p', 'Then it filled up. And I learned what I actually should have known on day one: the queue was not plumbing. The queue *was* the product, in the sense that every behaviour our customers experienced during a bad hour was a direct expression of decisions we had made — or failed to make — about that buffer.'],
      ['h2', 'A queue is a deferred decision'],
      ['p', 'When you put a queue between two components, you are saying: the producer may run faster than the consumer, and when it does, we will hold the difference. That sounds neutral. It is not. You have committed to answering three questions, and if you do not answer them deliberately, the system will answer them for you at the worst possible moment.'],
      ['ul', 'How much will you hold? A bound you never chose is still a bound — it is the size of your memory, your disk, or your cloud bill.', 'What happens when the bound is reached? Drop the newest, drop the oldest, block the producer, or fall over. There is no fifth option, only unchosen ones.', 'Who finds out? Backpressure that never reaches the caller is just latency with extra steps.'],
      ['quote', 'An unbounded queue is not a feature. It is a decision you have postponed until you are least equipped to make it.'],
      ['h2', 'Latency is a distribution, not a number'],
      ['p', 'The second thing the queue taught me is that a mean is a lie told by arithmetic. Our average end-to-end latency stayed comfortably flat through the entire incident. Our p99 went to four minutes. The customers who noticed were not the average ones; they never are.'],
      ['img', '@figure', 'Queue depth against consumer lag during a two-hour saturation event.'],
      ['p', 'What that graph shows is a system with no relief valve. Depth climbs, lag climbs with it, and neither recovers until the producer stops on its own — which is to say, until the business day ends. Nothing in the software noticed. Nothing in the software *could* notice, because we had not written down what "too full" meant.'],
      ['h2', 'What I do differently now'],
      ['p', 'I write the saturation behaviour first, before the happy path. It is four lines of policy and it forces the conversation that everyone would rather avoid: which requests are we willing to lose, and who are we willing to make wait?'],
      ['p', 'It is not a glamorous design exercise. But it is the one that decides how your system behaves on the day it matters, and that day is the only day anyone will remember.'],
    ],
  },
  {
    author: 'mayaokonkwo',
    title: "What I Learned Reading 40,000 Lines of Someone Else's Code",
    subtitle: 'Inheriting a codebase is an exercise in archaeology, empathy, and restraint.',
    tags: ['engineering', 'code-review', 'craft'],
    body: [
      ['p', 'In February I inherited a service written over four years by eleven people, six of whom had left the company. My mandate was vague in the way these mandates always are: "get familiar with it, then make it faster." I spent the first three weeks doing nothing but reading.'],
      ['p', 'Here is what reading forty thousand lines of code you did not write actually teaches you.'],
      ['h2', 'Every ugly thing is a fossil'],
      ['p', 'There is a moment, usually around day two, when you find the function. It is six hundred lines long. It has a parameter named `flag2`. It is wrapped in a try/except that swallows everything. And your first instinct — I know, because I have had it every single time — is contempt.'],
      ['p', 'Resist it, not for moral reasons but for practical ones. That function is a fossil record. Each strange branch is a preserved impression of something that once happened in production. The `flag2` parameter is there because a customer needed a behaviour on a Friday. The bare except is there because something upstream threw an exception nobody could reproduce.'],
      ['quote', 'Code is not a description of a problem. It is a record of every conversation the team had about that problem, compressed until it runs.'],
      ['h2', 'Read the history, not just the source'],
      ['p', 'The single highest-leverage tool in this work is not a language server. It is `git log -p` on one file at a time, oldest first. You get the sequence, and the sequence is the argument. You see the clean original, the first exception to it, the second, and then the refactor that tried to unify them and half-succeeded.'],
      ['ul', 'Commit messages tell you what people thought they were doing.', 'The diffs tell you what they actually did.', 'The gap between the two is where the bugs live.'],
      ['img', '@figure', 'Three weeks of reading notes, condensed to one page of subsystem boundaries.'],
      ['h2', 'The map is the deliverable'],
      ['p', 'At the end of those three weeks I had not shipped a line. What I had was a single page: seven boxes, the data that moves between them, and — critically — four sentences describing the invariants nobody had ever written down but everybody was relying on.'],
      ['p', 'That page made the optimisation work almost boring. We found the hot path in a day, because we finally knew which paths there were. The lesson I keep relearning: in unfamiliar code, comprehension is not the setup for the work. It is most of the work.'],
    ],
  },
  {
    author: 'mayaokonkwo',
    title: 'Idempotency Is a Design Stance, Not a Retry Flag',
    subtitle: 'You cannot bolt exactly-once onto a system that was built assuming it.',
    tags: ['distributed-systems', 'reliability', 'api-design'],
    body: [
      ['p', 'A retry is an admission that you do not know whether something happened. That is the whole of it. Every retry policy in every client library you have ever configured is a statement about uncertainty, and idempotency is the property that makes that uncertainty survivable.'],
      ['h2', 'The failure you cannot distinguish'],
      ['p', 'The network gives you three outcomes and lets you observe two. The request may have failed before the work. It may have failed after the work but before the response. From the caller\'s side these are the same silence.'],
      ['quote', 'In a distributed system, a timeout does not mean "it did not happen." It means "I no longer know."'],
      ['p', 'Which means the caller has exactly two safe moves: retry, and risk doing it twice; or do not retry, and risk not doing it at all. Idempotency collapses that dilemma. It makes the first option free.'],
      ['h2', 'Where teams get it wrong'],
      ['ul', 'Treating idempotency as a client concern. The client can send a key; only the server can honour it.', 'Keying on the request body. Two legitimately distinct requests can be byte-identical — think "charge $10" twice, on purpose.', 'Storing the key but not the response. If a retry returns a different answer than the original, you have deduplicated the write and corrupted the read.', 'Expiring keys faster than the longest client retry window. The window is set by the slowest client you have, not the one in your test suite.'],
      ['h2', 'A stance, not a flag'],
      ['p', 'The reason I call this a stance is that it cannot be retrofitted cheaply. Idempotency touches your data model — you need somewhere to record "I have seen this" — your API contract, and your definition of what a duplicate even is. That last one is a *product* question wearing an engineering costume.'],
      ['img', '@figure', 'The same request, three arrival paths, one recorded outcome.'],
      ['p', 'Decide it early, write it into the interface, and the retries take care of themselves. Decide it late and you will be writing reconciliation jobs for the rest of the system\'s life.'],
    ],
  },
  {
    author: 'mayaokonkwo',
    title: "On-Call Is a Design Review You Didn't Schedule",
    subtitle: 'The pager is the most honest feedback loop in software.',
    tags: ['on-call', 'reliability', 'engineering-culture'],
    body: [
      ['p', 'I have never learned as much about a system as I did in the fifteen minutes after it woke me at 03:40. There is a particular clarity to that moment. All the abstractions you were proud of are gone, and what is left is a graph, a log line, and a question: what is actually happening here?'],
      ['h2', 'The pager reviews what code review cannot'],
      ['p', 'Code review is good at local questions. Is this correct? Is it clear? Will this break the test? It is structurally bad at the questions that produce outages, because those questions are about *composition* — about what happens when this correct component meets that correct component under load neither anticipated.'],
      ['quote', 'Every page is a design review conducted by production, with no agenda, no politeness, and perfect information.'],
      ['h2', 'Reading pages as a corpus'],
      ['p', 'One page is noise. Forty pages is a document. Once a quarter I export every alert that fired and sort them not by service but by *cause*, and the categories are always more boring and more actionable than the individual incidents suggested.'],
      ['ul', 'Alerts that fired on a symptom nobody could act on. Delete or re-aim these; they are training people to ignore the pager.', 'Alerts that fired correctly but too late to matter. These are threshold problems, not detection problems.', 'Alerts that fired for a dependency you do not own. These need a different response path, not a louder one.', 'Alerts that never fired but should have. You find these only by reading incident timelines backwards.'],
      ['img', '@figure', 'One quarter of alerts, regrouped by root cause instead of by service.'],
      ['h2', 'Humane on-call is a technical outcome'],
      ['p', 'I want to be careful here, because "on-call humaneness" gets filed under culture, and culture gets filed under someone else\'s job. It is not. The number of times a human is woken up is a direct output of technical decisions: what you bounded, what you made idempotent, what you made degrade instead of fail.'],
      ['p', 'If your rotation is painful, that pain is data about the architecture. Treat it that way and the fix is usually in the code, not the calendar.'],
    ],
  },

  /* --------------------------- Tobias --------------------------- */
  {
    author: 'tobiaslind',
    title: 'Type at Rest: Designing for the Long Read',
    subtitle: 'Most typography advice optimises for the first ten seconds. Reading takes longer than that.',
    tags: ['typography', 'design', 'reading'],
    body: [
      ['p', 'There are two typographic problems and we mostly solve the wrong one. The first is *attraction*: making someone stop. The second is *endurance*: making it possible for that person to stay for two thousand words without their attention quietly leaking out.'],
      ['p', 'Attraction is well served. Every trend of the last decade — enormous display weights, tight tracking, high-contrast pairings — is optimised for the moment of arrival. Endurance is barely discussed, and it is the harder craft.'],
      ['h2', 'The measure is the whole argument'],
      ['p', 'If you fix one thing, fix line length. Somewhere between 60 and 75 characters is the range where the eye can find the next line without the head moving and without the return sweep losing its place. Below 50 the rhythm fractures. Above 90 the reader starts re-reading lines, and — this is the important part — they will not know why they are tired.'],
      ['quote', 'Bad typography rarely announces itself. It just makes the reader feel that the piece was too long.'],
      ['h2', 'Leading is a function of measure'],
      ['p', 'Line height is not a constant you pick once. It is proportional to line length, because the return sweep gets harder as the line gets longer. At 65 characters, 1.5 is comfortable. Push the measure to 85 and you need 1.7 just to keep the reader on the rails.'],
      ['ul', 'Set the measure first, then the leading. Doing it in the other order is how you end up with airy short lines and cramped long ones.', 'Increase leading slightly for lighter type colour, decrease it for denser faces.', 'Never let the paragraph gap be smaller than the leading — the eye reads whitespace as structure.'],
      ['img', '@figure', 'Identical text at three measures: 45, 68, and 96 characters per line.'],
      ['h2', 'Serifs, and the argument I keep having'],
      ['p', 'I do not believe serifs are inherently more readable on screen; the research is muddier than either camp admits. What I do believe is that a well-set serif *signals* long-form, and that signal changes how people approach the page. They settle in. That is not a typographic effect, it is a cultural one — and it is still real.'],
      ['p', 'Use the sans for the interface, the serif for the argument, and let the reader feel the difference before they can name it.'],
    ],
  },
  {
    author: 'tobiaslind',
    title: 'The Case Against the Hamburger Menu, Ten Years Late',
    subtitle: 'We hid the navigation to save space, then spent a decade paying for it.',
    tags: ['design', 'navigation', 'ux'],
    body: [
      ['p', 'I designed my first hamburger menu in 2013 and I was delighted with it. Three lines. All that navigation, folded away. The mockup looked so calm.'],
      ['p', 'The thing about calm mockups is that they are calm because nothing is happening in them.'],
      ['h2', 'What we actually traded'],
      ['p', 'The hamburger was a trade: visual simplicity in exchange for discoverability. That was defensible in 2013, when screens were small and nobody had space. It is much less defensible now, and yet the pattern outlived its justification by roughly a decade — because it had stopped being a decision and become a default.'],
      ['quote', 'A pattern survives longest not when it works best, but when nobody remembers it was ever a choice.'],
      ['h2', 'The measurable cost'],
      ['ul', 'Anything behind the menu gets a fraction of the engagement of anything in front of it. The exact fraction varies; the direction never does.', 'Users cannot form a mental model of a site whose structure they have never seen at once.', 'Two taps to reach anywhere means the second-most-important destination costs the same as the twelfth.'],
      ['img', '@figure', 'The same nav, exposed and collapsed, with relative engagement per destination.'],
      ['h2', 'What to do instead'],
      ['p', 'Show three to five destinations. Genuinely three to five — the exercise of choosing them is the entire value. If you cannot get below five, the problem is not your navigation, it is that you have not decided what your product is for.'],
      ['p', 'And on the smallest screens, where the trade still has some force: put the essentials in a bottom bar and let the overflow menu hold the actual overflow. The menu is not the enemy. Using it as a place to avoid deciding is.'],
    ],
  },
  {
    author: 'tobiaslind',
    title: 'Grids Are a Conversation, Not a Cage',
    subtitle: 'A grid you never break is a grid that is doing half its job.',
    tags: ['design', 'layout', 'grids'],
    body: [
      ['p', 'Every young designer goes through a grid phase. I did. You discover the twelve-column layout, everything snaps, and for about six months your work gets dramatically better. Then it plateaus, and it plateaus in a very specific way: everything you make is *correct* and nothing you make is *memorable*.'],
      ['h2', 'The grid exists to make the exception legible'],
      ['p', 'This is the reframe that got me off the plateau. A grid is not a system for placing things. It is a system for establishing an expectation, so that when you violate the expectation the reader feels it as emphasis rather than as error.'],
      ['quote', 'Regularity is what gives an irregularity meaning. Without the grid, breaking the grid is just noise.'],
      ['p', 'Look at any newspaper front page from the era when people still designed them by hand. Six columns, rigidly kept — and then one photograph that runs across four of them. The photograph is loud *because* the six columns were quiet.'],
      ['h2', 'Practical rules I actually use'],
      ['ul', 'Break the grid at most once per screen. Two exceptions cancel each other out.', 'Break it with the most important thing, never with the most decorative thing.', 'Keep the baseline even when you break the columns — vertical rhythm is the thread that survives.', 'If you cannot articulate what the break is emphasising, snap it back.'],
      ['img', '@figure', 'A strict six-column layout with a single deliberate four-column intrusion.'],
      ['h2', 'On tooling'],
      ['p', 'Modern CSS grid is the best layout tool we have ever had and it has a subtle failure mode: it makes arbitrary placement so easy that the discipline has to come entirely from you. The tool no longer resists. That is freedom, and freedom is where the plateau lives.'],
      ['p', 'Set the constraint yourself. Then earn the exception.'],
    ],
  },

  /* ---------------------------- Priya --------------------------- */
  {
    author: 'priyaraman',
    title: 'Small Models, Sharp Questions',
    subtitle: 'Capability is not the bottleneck in most deployed systems. Specification is.',
    tags: ['machine-learning', 'evaluation', 'systems'],
    body: [
      ['p', 'I spent eight months last year trying to improve a classifier by making it bigger. I got two points. Then I spent three weeks rewriting the label definition and got eleven.'],
      ['p', 'This is not an argument that scale does not work. It obviously works. It is an argument that in the specific regime most of us operate in — a bounded task, a real dataset, a deadline — the returns to *sharpening the question* are routinely larger than the returns to enlarging the model, and we systematically under-invest in the former because it is less fun.'],
      ['h2', 'The label is the specification'],
      ['p', 'Every supervised system encodes its task definition entirely in its labels. If two annotators disagree 15% of the time, you have set a ceiling on accuracy at roughly 85% and no architecture will get you past it. You are not fighting the model. You are fighting an ambiguity you inherited.'],
      ['quote', 'Your model cannot be more coherent than your label definition. Nothing in the training loop repairs a question that was never well posed.'],
      ['h2', 'How to sharpen'],
      ['ol', 'Take 200 examples and have two people label them independently. Measure agreement before you look at any model metric.', 'Read every disagreement. Not a sample — every one. They cluster, and the clusters are your real taxonomy.', 'Rewrite the definition to resolve the largest cluster. Do not add a class; add a decision rule.', 'Re-label and re-measure agreement. Repeat until agreement stops moving.'],
      ['img', '@figure', 'Annotator agreement before and after three rounds of definition sharpening.'],
      ['h2', 'Then, and only then, scale'],
      ['p', 'Once the question is sharp, capacity converts cleanly into performance and you can reason about the trade. Before the question is sharp, extra capacity mostly buys you a more confident model with the same confusion — which is strictly worse, because now the errors look authoritative.'],
      ['p', 'Small model, sharp question, honest evaluation. In production that combination has beaten the alternative for me nearly every time.'],
    ],
  },
  {
    author: 'priyaraman',
    title: 'Your Evaluation Set Is Lying to You',
    subtitle: 'Not maliciously. Just consistently, and in the direction you would prefer.',
    tags: ['machine-learning', 'evaluation', 'research'],
    body: [
      ['p', 'There is a specific kind of disappointment that comes from a model which performs beautifully on your held-out set and then falls apart in front of a real user. I have felt it enough times to have stopped blaming the users.'],
      ['h2', 'Four ways a test set drifts from reality'],
      ['ul', '**Selection.** Your evaluation data came from somewhere, and that somewhere had a filter. Logs are filtered by who was already using the product.', '**Staleness.** The world moved. Your benchmark did not. The gap grows silently, and the metric does not have a way to tell you.', '**Contamination.** Increasingly the honest answer to "did the model see this?" is "probably, somewhere." Any public benchmark old enough to be standard is old enough to be leaked.', '**Aggregation.** A single number over a heterogeneous population hides the subgroup where you are failing badly, especially when that subgroup is small and important.'],
      ['quote', 'A benchmark is a proxy that was once well correlated with what you cared about. Correlation is not a permanent condition.'],
      ['h2', 'The slice is the unit of truth'],
      ['p', 'The most useful change I made to my own practice was to stop reporting a headline number to myself. Internally I keep a table: fifteen named slices, each with a hypothesis about why it might be hard, each tracked over time. The headline still goes in the paper. The table is what I actually steer by.'],
      ['img', '@figure', 'One model, fifteen slices: the headline number is the flattest line on the chart.'],
      ['h2', 'Build an adversarial habit'],
      ['p', 'Once a month I try to break my own best model on purpose and I write down what worked. It takes an afternoon. It has caught more real problems than any automated monitor I have ever configured, because the failures that matter are usually the ones nobody thought to instrument.'],
      ['p', 'Your evaluation set is not going to volunteer its blind spots. That part is your job.'],
    ],
  },
  {
    author: 'priyaraman',
    title: 'Attention Is Not Understanding',
    subtitle: 'On the seductive habit of reading mechanism as meaning.',
    tags: ['machine-learning', 'interpretability', 'research'],
    body: [
      ['p', 'The attention map is beautiful. It is a heat map, it is legible, it is *right there*, and it appears to show you what the model is thinking about. Nearly every interpretability talk I saw for three years opened with one.'],
      ['p', 'The problem is that "what the model attends to" and "what the model uses" are different claims, and the visualisation smuggles the second in wearing the clothes of the first.'],
      ['h2', 'Why the inference fails'],
      ['ul', 'Attention weights are one factor in a product. A high weight on a near-zero value vector contributes nothing.', 'Information routes around attention entirely — residual streams carry a great deal that never shows up in the map.', 'Different attention distributions can produce identical outputs. If the explanation is not unique, it is not an explanation.'],
      ['quote', 'A mechanism you can visualise is not the same as a mechanism you have understood. Legibility is not evidence.'],
      ['h2', 'The test that matters'],
      ['p', 'The only interpretability claim I now take seriously is one that survives intervention. If you say the model uses feature X, then ablate X and show me the behaviour changes in the way your theory predicts. If nothing moves, the theory was decoration.'],
      ['img', '@figure', 'Attention weight versus measured causal effect, per head. The correlation is weaker than the pictures suggest.'],
      ['h2', 'Why this matters beyond the paper'],
      ['p', 'This is not a purely academic complaint. Attention maps get shipped into products as explanations for users and into regulatory filings as evidence of accountability. When we present a correlational artefact as a causal account, we are not just being imprecise — we are transferring unearned confidence to people who cannot check it.'],
      ['p', 'Intervene, or hold the claim loosely. There is not really a third option.'],
    ],
  },
  {
    author: 'priyaraman',
    title: 'The Quiet Cost of Synthetic Data',
    subtitle: 'Generated data solves your volume problem and hides your coverage problem.',
    tags: ['machine-learning', 'data', 'evaluation'],
    body: [
      ['p', 'Synthetic data is the most effective tool I have for the specific problem of "we do not have enough examples of this rare thing," and I recommend it constantly. This piece is about the bill that arrives afterwards.'],
      ['h2', 'Generated data inherits a generator\'s blind spots'],
      ['p', 'When you generate examples with a model, the distribution you get is the generator\'s idea of the distribution. Where the generator is confident and wrong, you now have thousands of confident, wrong examples — and they look exactly as clean as the good ones. Nothing in the file indicates which is which.'],
      ['quote', 'Real data is noisy in ways that are informative. Synthetic data is clean in ways that are not.'],
      ['h2', 'The failure mode is narrowing, not error'],
      ['p', 'What I see in practice is rarely a model that gets worse on the metric. It is a model that gets *narrower*: excellent on the modes the generator over-produced, quietly degraded on the tails it under-produced. The average holds. The edges erode. And because your evaluation set often came from the same pipeline, the erosion is invisible.'],
      ['ul', 'Never evaluate on synthetic data. Ever. Hold out real examples even if you only have two hundred of them.', 'Track the ratio of synthetic to real per class, not overall. It is always more skewed than you expect.', 'Sample fifty generated examples per round and read them. Yes, by hand.', 'Version the generator alongside the dataset — a generator upgrade is a distribution change.'],
      ['img', '@figure', 'Coverage of a real corpus versus its synthetic counterpart, projected to two dimensions.'],
      ['p', 'Use it. It works. Just do not let the volume of it convince you that you have solved a coverage problem you have actually only papered over.'],
    ],
  },

  /* --------------------------- Desmond -------------------------- */
  {
    author: 'desmondhale',
    title: 'In Praise of the Second Draft',
    subtitle: 'The first draft is for finding out what you think. Everything after is the writing.',
    tags: ['writing', 'craft', 'essays'],
    body: [
      ['p', 'I have never once written a first draft I was willing to show anyone, and after twenty years I have stopped treating this as a personal failing. It is simply what a first draft is for. The first draft is a research instrument. You are not communicating yet; you are finding out what you believe.'],
      ['h2', 'The two jobs, and why they conflict'],
      ['p', 'Writing does two incompatible things. It discovers, and it transmits. Discovery wants permission, mess, tangents, the freedom to be wrong in public with yourself. Transmission wants compression, order, and the ruthless removal of anything that served the discovery but does not serve the reader.'],
      ['quote', 'The first draft is written for the writer. Every draft after it is written for someone else. Confusing the two is the whole of writer\'s block.'],
      ['h2', 'What the second draft actually does'],
      ['ul', 'It finds the real opening, which is almost always on page two. The first page was your throat-clearing.', 'It deletes the sentence you were most proud of. That sentence is usually load-bearing for your ego and nothing else.', 'It notices that the essay changed its mind halfway through, and decides which half was right.', 'It converts your process into an argument — because the order you *discovered* things in is almost never the order a reader needs them in.'],
      ['img', '@figure', 'A marked-up second draft: the opening three paragraphs struck through entirely.'],
      ['h2', 'On not skipping it'],
      ['p', 'The economics of publishing now reward volume, and the honest temptation is to publish the first draft with the typos fixed. I have done it. The pieces are not terrible. They are just *unresolved* — you can feel the writer still thinking, and thinking is not a spectator sport.'],
      ['p', 'A second draft costs a day. It is the cheapest quality intervention available to anyone who writes, and almost nobody does it, which is a strange and durable advantage for those who do.'],
    ],
  },
  {
    author: 'desmondhale',
    title: 'Writing Is Thinking Slowed Down Enough to Be Caught',
    subtitle: 'Why the page catches errors the mind will happily wave through.',
    tags: ['writing', 'thinking', 'essays'],
    body: [
      ['p', 'There is a common piece of advice — write to clarify your thinking — which is true and which almost nobody explains. *Why* does it clarify? What is the mechanism?'],
      ['p', 'I think the answer is speed. Thought runs faster than language, and it cheats. It gestures at a step and moves on. Writing cannot gesture. Writing has to actually produce the step, in order, in words, and the requirement to produce it is what exposes that you never had it.'],
      ['h2', 'The gap you cannot see from inside'],
      ['p', 'Try this: think through an argument you hold confidently. It will feel complete. Now write it down for a sceptical reader. Somewhere around the third paragraph you will hit a joint where you had been substituting a feeling of obviousness for an actual inference.'],
      ['quote', 'You cannot notice a missing step at the speed of thought, because the noticing and the missing happen in the same instant.'],
      ['h2', 'Why an audience helps even when imagined'],
      ['p', 'Writing for no one lets you keep cheating; you will accept your own shorthand. The imagined reader is a constraint engine. Pick a specific one — a smart friend outside your field is the classic choice, and it is classic because it works.'],
      ['ul', 'They will not accept jargon, so you must define it, and defining it is where you discover you were using it loosely.', 'They will not grant your priors, so you must state them.', 'They have no obligation to keep reading, so structure becomes a real problem rather than a stylistic one.'],
      ['img', '@figure', 'Handwritten notes for an essay, with the reasoning gaps circled in a later pass.'],
      ['h2', 'The practical version'],
      ['p', 'I keep a document per unresolved question. Not a journal — a case file. When I think I have concluded something, I write the conclusion at the top and then try to justify it beneath. About a third of the time the justification fails and I delete the conclusion.'],
      ['p', 'That third is the entire return on the practice. Everything else is bookkeeping.'],
    ],
  },
  {
    author: 'desmondhale',
    title: 'The Notebook Problem',
    subtitle: 'On collecting so many ideas that you never develop one.',
    tags: ['writing', 'attention', 'craft'],
    body: [
      ['p', 'At one point I had four hundred and thirty notes tagged "essay idea." I had a system. The system had a colour scheme. What I did not have, that year, was an essay.'],
      ['h2', 'Capture feels like progress'],
      ['p', 'The trap is that capturing an idea produces almost exactly the same sensation as having a productive session — the small satisfying click of something filed. But an idea in a notebook has not been tested against anything. It is a hypothesis in storage, and storage costs are low enough now that we never have to choose.'],
      ['quote', 'A note is a promise to think later. Four hundred notes is a debt you will not repay.'],
      ['h2', 'Ideas do not keep well'],
      ['p', 'This is the part that took me longest to accept. I believed ideas were durable — that a good one would still be good in two years. Mostly they are not, because most of what made an idea good was the *context you were in* when you had it: the argument you had just heard, the mood, the specific irritation. Two years later the note reads like a stranger\'s.'],
      ['ul', 'Ideas that survive re-reading after a month are worth developing. Nothing else is.', 'A note without a reason it mattered is unrecoverable. Always write the *why*, not just the *what*.', 'Reviewing the whole archive is a procrastination ritual dressed as diligence.'],
      ['img', '@figure', 'Four hundred captured notes; the eleven that ever became something.'],
      ['h2', 'What I do now'],
      ['p', 'One list, capped at twenty. To add something when the list is full, I must delete something. This is artificial and slightly painful and it has been worth more to my output than any tool I have ever adopted, because the pain is the evaluation. If I cannot bring myself to cut anything for a new arrival, the new arrival was not that good.'],
      ['p', 'Scarcity does the selecting that abundance lets you avoid.'],
    ],
  },

  /* ---------------------------- Lucía --------------------------- */
  {
    author: 'luciamoreau',
    title: 'Your Roadmap Is a Story About Uncertainty',
    subtitle: 'Stop pretending the third quarter is knowable and start saying what you would bet on.',
    tags: ['product', 'planning', 'startups'],
    body: [
      ['p', 'Every roadmap I have ever seen presents four quarters with equal confidence. Q1 is a plan. Q4 is a wish. They are rendered in the same font, the same box width, the same shade of blue, and that visual equivalence is a lie that the document tells before anyone reads a word.'],
      ['h2', 'Confidence should be visible'],
      ['p', 'The single most useful change my team made was to stop drawing the roadmap as a timeline and start drawing it as three tiers: committed, likely, and exploratory. Same items, different epistemic status, and — crucially — different *rules*.'],
      ['ul', '**Committed:** we have scoped it, we have the people, we will say so publicly. Moving this costs us credibility and we treat it accordingly.', '**Likely:** we believe in the problem and have a hypothesis about the solution. Dates are ranges. Sequencing may change.', '**Exploratory:** we think this matters. We have not validated the shape. No dates at all, and no one downstream may plan against it.'],
      ['quote', 'A roadmap that expresses no uncertainty is not a forecast. It is a promise you have not yet noticed you cannot keep.'],
      ['h2', 'What this fixes'],
      ['p', 'It fixes the sales conversation, which is where roadmap damage actually happens. When everything looks equally certain, an account executive will quite reasonably promise Q4 to close a deal in Q1. Tiering gives them a truthful thing to say instead — and salespeople, in my experience, would much rather have a truthful thing to say than a hedge.'],
      ['img', '@figure', 'The same twelve initiatives, drawn as a timeline and drawn as confidence tiers.'],
      ['h2', 'The cost'],
      ['p', 'The cost is that you must actually decide what you are confident about, in writing, in front of your executives. That is uncomfortable and it is also the entire point. A planning process that never produces discomfort has not made a decision.'],
    ],
  },
  {
    author: 'luciamoreau',
    title: 'Ship the Boring Half First',
    subtitle: 'The unglamorous part of the feature is usually the part that determines whether it works.',
    tags: ['product', 'shipping', 'engineering'],
    body: [
      ['p', 'Nearly every feature has a glamorous half and a boring half. The glamorous half is what goes in the announcement. The boring half is import, export, permissions, empty states, error messages, and what happens when someone has four thousand of the thing instead of four.'],
      ['p', 'Teams build the glamorous half first, almost universally, because it is the part everyone can picture. And then the boring half gets whatever time is left, which is never enough, and the feature ships in a state where it demos wonderfully and cannot actually be adopted.'],
      ['h2', 'Adoption lives in the boring half'],
      ['quote', 'Customers do not evaluate your feature. They evaluate the worst part of your feature that they hit on day one.'],
      ['p', 'The reason is simple. The glamorous half is what a user experiences in the demo. The boring half is what they experience during *migration* — and migration is a wall that stands between every prospective user and your beautiful new thing.'],
      ['h2', 'Inverting the order'],
      ['ol', 'Write the migration path before the feature. If there is no answer for existing data, you have not designed the feature yet.', 'Build permissions and empty states in the first week, not the last. Both change the data model, and both are catastrophically expensive to retrofit.', 'Test at the 99th percentile of scale you have actually observed, not the median.', 'Only then build the part that will be in the screenshot.'],
      ['img', '@figure', 'Effort allocation on two comparable launches: glamour-first versus boring-first.'],
      ['h2', 'The organisational objection'],
      ['p', 'The pushback is always about momentum: the team needs a visible win, the stakeholders need to see progress. This is real, and I do not dismiss it. But a visible win that cannot be adopted is a debt, and it is a debt that comes due in a quarter, in public, with the CEO asking why usage is flat.'],
      ['p', 'Boring first. The screenshot will still be there in three weeks.'],
    ],
  },
  {
    author: 'luciamoreau',
    title: 'Pricing Is Product Design',
    subtitle: 'The pricing page is the most-read spec document your company produces.',
    tags: ['pricing', 'product', 'startups'],
    body: [
      ['p', 'For most of my career pricing happened in a spreadsheet, somewhere near finance, roughly two weeks before launch. It was treated as a packaging decision applied to a finished product.'],
      ['p', 'This is backwards, and the tell is that changing the price changes the product. Not metaphorically — materially. Charge per seat and you will build collaboration features. Charge per usage and you will build efficiency features. The pricing model selects your roadmap.'],
      ['h2', 'The metric is the message'],
      ['p', 'Whatever you meter is what you have told the customer your product is *for*. If you charge per API call, you have said the calls are the value. If the customer thinks the value is the outcome, you have created a permanent, low-grade argument that will surface in every renewal.'],
      ['quote', 'Your billing metric is a claim about where value is created. Get it wrong and every conversation with your customer becomes a negotiation about that claim.'],
      ['h2', 'What good metrics have in common'],
      ['ul', 'The customer can predict it. Unpredictable bills produce churn even when the total is small.', 'It grows when their success grows, not when their *usage* grows. These are different and the difference is where resentment lives.', 'It is not gameable in a way that damages the product — if customers can save money by using you badly, they will use you badly.', 'It is explainable in one sentence to someone who has not read the docs.'],
      ['img', '@figure', 'Three pricing metrics and the feature roadmap each one implies.'],
      ['h2', 'Design it early'],
      ['p', 'Draft the pricing page in the first month, alongside the spec — not to commit to numbers, but to force the question of what you are claiming to be worth paying for. If the page is hard to write, the product is not yet clear. That signal is available months before any other signal you will get.'],
    ],
  },

  /* ---------------------------- Kenji --------------------------- */
  {
    author: 'kenjiwatanabe',
    title: 'Gardening Taught Me More About SRE Than Any Postmortem',
    subtitle: 'Both disciplines are about steady state, and neither one lets you rush it.',
    tags: ['sre', 'reliability', 'essays'],
    body: [
      ['p', 'I started a vegetable garden the same year I took over an on-call rotation, and I did not expect the two to have anything to do with each other. Six seasons later I think of them as the same discipline practised on different substrates.'],
      ['h2', 'You cannot debug a system by staring at one plant'],
      ['p', 'My first year I lost a whole row of tomatoes and spent weeks inspecting individual leaves. The problem was drainage — a property of the entire bed, invisible at the level of any single plant, obvious the moment I dug a hole and watched it hold water for an hour.'],
      ['p', 'This is exactly the mistake I watch engineers make during an incident, myself very much included. The trace of one slow request is fascinating and it is almost never where the answer is. The answer is a property of the bed.'],
      ['quote', 'Most production problems are not in a component. They are in the conditions the components share.'],
      ['h2', 'Interventions have a lag'],
      ['p', 'Compost does nothing for weeks. Then it does everything, slowly, for a year. Nothing in the garden responds on the timescale of your attention, which means the feedback loop you are trying to learn from is longer than your patience — and the temptation is always to intervene again before the first intervention has reported back.'],
      ['ul', 'Change one thing. In a garden this is obvious; in production we routinely ship four fixes at once and then cannot say which worked.', 'Write down what you expect to happen and when. Without a prediction, any outcome confirms the theory.', 'Wait for the full cycle. Rolling back at hour two of a twelve-hour effect is how teams conclude, wrongly, that something did not help.'],
      ['img', '@figure', 'Six seasons of yield notes — the year the drainage was fixed is visible from across the room.'],
      ['h2', 'Steady state is an achievement, not a default'],
      ['p', 'The deepest similarity is this: neither a garden nor a service tends toward health on its own. Left alone, both go to weeds — entropy in one case, config drift and dependency rot in the other. Stability is not the absence of work. It is a specific, ongoing, mostly invisible kind of work.'],
      ['p', 'The gardener knows this and does not resent it. That, more than any technique, is what I brought back to the rotation.'],
    ],
  },
  {
    author: 'kenjiwatanabe',
    title: 'The Runbook Nobody Reads',
    subtitle: 'Documentation written for an audience that does not exist at 3am.',
    tags: ['sre', 'documentation', 'on-call'],
    body: [
      ['p', 'We had ninety-four runbooks. I know the number because I counted them during a quarter when I was trying to work out why, despite ninety-four runbooks, every incident still ended with someone paging the same two people.'],
      ['h2', 'Written for the wrong reader'],
      ['p', 'Nearly all of them were written by the person who built the system, shortly after building it, for a reader who understood the system. That reader does not exist at 3am. The reader at 3am is frightened, half-awake, and has never seen this service before.'],
      ['quote', 'A runbook is not documentation. It is an instruction set for a specific person in a specific state: tired, alone, and under time pressure.'],
      ['h2', 'What actually works'],
      ['ul', 'Start with the symptom, not the system. People arrive via an alert, not via a table of contents.', 'The first line must be an action. Not context, not architecture — a command they can run right now to learn something.', 'Include the exact command with the exact flags. "Check the queue depth" is not a step; it is a homework assignment.', 'Say what a normal value looks like. Half of on-call is not knowing whether 400 is a lot.', 'Name the escalation path *and* the condition for using it. "If depth is still climbing after ten minutes, page the data team" beats "escalate if needed."'],
      ['img', '@figure', 'A rewritten runbook: symptom at the top, first command in the first line.'],
      ['h2', 'Test them like code'],
      ['p', 'The change that actually moved our numbers was requiring every runbook to be executed, start to finish, by someone who had never touched that service — during business hours, with the author watching in silence. Watching in silence is the hard part and the whole point.'],
      ['p', 'Every single one failed the first time. Ninety-four for ninety-four. That is not an indictment of the authors; it is just what happens when you write for a reader you cannot imagine because you have never been them about your own system.'],
    ],
  },
  {
    author: 'kenjiwatanabe',
    title: 'Latency Is a Feeling',
    subtitle: 'Users do not experience milliseconds. They experience doubt.',
    tags: ['performance', 'ux', 'sre'],
    body: [
      ['p', 'We shaved 180 milliseconds off a page load and nobody noticed. The following quarter we added a skeleton screen, changed nothing about the actual timing, and support tickets about "the app being slow" dropped by a third.'],
      ['p', 'I want to be careful about the lesson here, because the obvious reading — perception is all that matters, so stop optimising — is wrong and dangerous. The real lesson is more specific.'],
      ['h2', 'Uncertainty is the cost, not duration'],
      ['p', 'Waiting is tolerable when you know it is working and roughly how long it will take. The same wait is intolerable when you do not know whether anything is happening. What users report as "slow" is very often "I could not tell if it was broken."'],
      ['quote', 'A three-second wait with a progress bar feels shorter than a one-second wait with a frozen screen. Both facts are about certainty, not speed.'],
      ['h2', 'The thresholds that actually matter'],
      ['ul', 'Under ~100ms feels instantaneous — the action and the result are one event. Protect this fiercely for anything typed or dragged.', 'Up to ~1s keeps flow intact but needs no indicator. Adding a spinner here makes things feel *worse*.', 'Beyond ~1s you must acknowledge, or the user starts wondering. This is where the ticket gets written.', 'Beyond ~10s the user has left. The only useful design is one that lets them do something else and come back.'],
      ['img', '@figure', 'Reported "slowness" against measured p95, before and after adding progress feedback.'],
      ['h2', 'Where the honest work is'],
      ['p', 'Perception engineering buys you the middle band. It does not buy you the tail, and the tail is where the real damage is: a p99 of eleven seconds is not a communication problem, it is a broken experience for one request in a hundred — which, at any real volume, means most active users hit it weekly.'],
      ['p', 'Fix the tail with engineering. Fix the doubt with design. Do not use either as a substitute for the other.'],
    ],
  },

  /* ---------------------------- Drafts -------------------------- */
  {
    author: 'tobiaslind',
    title: 'Color Systems That Survive Contact With Engineers',
    subtitle: 'A palette is not a list of hexes. It is a set of promises about contrast.',
    tags: ['design', 'color', 'design-systems'],
    draft: true,
    body: [
      ['p', 'Draft — still working out the second half. The thesis: every colour system I have shipped has degraded within two quarters, and it always degrades the same way. Someone needs a hover state that is not in the palette, they eyeball it, and now there are two greys that differ by three percent lightness and no one can say which is correct.'],
      ['h2', 'Name by role, not by value'],
      ['p', 'A token called `grey-400` invites substitution: any grey near 400 will do. A token called `border-subtle` does not, because it carries the intent. This is the whole trick and I have never seen it fail when it was actually followed.'],
      ['quote', 'If a token name describes what the colour looks like, you have documented a value. If it describes what the colour is for, you have documented a decision.'],
      ['ul', 'Every token needs a stated contrast obligation, checked in CI.', 'Dark mode is not an inversion; it is a second system with the same roles.', 'Semantic colours (success, danger) need three roles each — fill, text, border — or people will invent them.'],
      ['img', '@figure', 'The same interface with role-named tokens and with value-named tokens, after two quarters of drift.'],
      ['p', 'TODO: finish the section on programmatic generation, and find out whether the CI contrast check actually caught anything last quarter or if I am just assuming it did.'],
    ],
  },
  {
    author: 'desmondhale',
    title: 'Against Productivity, For Attention',
    subtitle: 'Notes toward an essay about the difference between doing more and doing something.',
    tags: ['attention', 'writing', 'essays'],
    draft: true,
    body: [
      ['p', 'Draft. Rough. The argument I am circling: productivity is a measure of throughput, and throughput is the wrong measure for any work whose value is non-linear in quantity. Which is most work worth doing.'],
      ['h2', 'The substitution'],
      ['p', 'Somewhere in the last two decades we substituted a measure for the thing. Not deliberately — measures are useful and this one is easy to compute. But the substitution has a cost: it makes the four hours of staring at a problem indistinguishable from four hours of doing nothing, because neither produces output.'],
      ['quote', 'Attention has no unit. That is not a flaw in attention; it is a flaw in our instruments.'],
      ['ul', 'Open: the week I completed forty tasks and moved nothing.', 'Middle: why the tools optimise for what they can see.', 'Need a counterargument section — the honest case for throughput. Deadlines are real. Steel-man this properly.', 'Close: what a practice organised around attention would actually look like day to day.'],
      ['p', 'TODO: the counterargument section is weak and I know it. Also find the Simone Weil passage on attention as the rarest form of generosity — it may be the epigraph, or it may be too on-the-nose.'],
    ],
  },
  {
    author: 'kenjiwatanabe',
    title: 'Notes Toward a Calmer Pager',
    subtitle: 'Working draft: an alerting philosophy for teams that would like to sleep.',
    tags: ['on-call', 'sre', 'alerting'],
    draft: true,
    body: [
      ['p', 'Draft for the team, not for publication yet. Collecting the principles we have been applying informally so we can argue about them explicitly.'],
      ['h2', 'Principles so far'],
      ['ol', 'Every alert names a human action. If the response is "look at it," it is a dashboard, not an alert.', 'Page on symptoms the user can feel; ticket on causes only you can see.', 'An alert that fires more than twice a month without an incident is retired automatically. No debate, no owner override.', 'Nothing pages outside business hours unless it would still matter at 9am. The test is honest and it removes about a third of them.'],
      ['quote', 'The goal is not fewer alerts. It is that every remaining alert is believed.'],
      ['ul', 'Open question: how do we handle slow-burn issues that are not urgent tonight but will be urgent Saturday?', 'Open question: who owns the retirement decision when the alert is on a shared dependency?'],
      ['img', '@figure', 'Pages per week over six months, annotated with each retirement.'],
      ['p', 'TODO: get the actual numbers from last quarter before circulating. My recollection of the improvement is probably generous.'],
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Seed
 * ------------------------------------------------------------------ */

function clearGeneratedUploads() {
  for (const file of fs.readdirSync(UPLOADS_DIR)) {
    if (file.startsWith('seed-')) fs.rmSync(path.join(UPLOADS_DIR, file), { force: true });
  }
}

function wipe() {
  db.pragma('foreign_keys = OFF');
  for (const table of ['reshares', 'saves', 'reactions', 'article_tags', 'tags', 'articles', 'users']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  try {
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('users','articles','tags','reshares')").run();
  } catch {
    /* sqlite_sequence only exists once an AUTOINCREMENT table has been written */
  }
  db.pragma('foreign_keys = ON');
}

function daysAgoIso(days, hourOffset = 9) {
  const d = new Date();
  d.setUTCHours(hourOffset, 17, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function run() {
  console.log('› Seeding michigan…\n');
  clearGeneratedUploads();
  wipe();

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO users (username, email, password_hash, name, bio, avatar_url, cover_url,
                        twitter, github, linkedin, website, created_at)
     VALUES (@username, @email, @password_hash, @name, @bio, @avatar_url, @cover_url,
             @twitter, @github, @linkedin, @website, @created_at)`,
  );

  const userIdByUsername = new Map();

  USERS.forEach((u, i) => {
    const avatarUrl = writeUpload(`seed-avatar-${u.username}.svg`, avatarSvg(u.name, u.username));
    const coverUrl = writeUpload(
      `seed-profile-cover-${u.username}.svg`,
      bandsSvg({ width: 1600, height: 400, key: u.username, label: `${u.name} cover`, seedNote: 'profile' }),
    );
    const info = insertUser.run({
      username: u.username,
      email: u.email,
      password_hash: passwordHash,
      name: u.name,
      bio: u.bio,
      avatar_url: avatarUrl,
      cover_url: coverUrl,
      twitter: u.twitter,
      github: u.github,
      linkedin: u.linkedin,
      website: u.website,
      created_at: daysAgoIso(400 - i * 23, 8),
    });
    userIdByUsername.set(u.username, Number(info.lastInsertRowid));
  });

  console.log(`  ✓ ${USERS.length} users`);

  const insertArticle = db.prepare(
    `INSERT INTO articles (author_id, slug, title, subtitle, excerpt, cover_url, content_json,
                           content_html, reading_time, status, published_at, created_at, updated_at)
     VALUES (@author_id, @slug, @title, @subtitle, @excerpt, @cover_url, @content_json,
             @content_html, @reading_time, @status, @published_at, @created_at, @updated_at)`,
  );
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const linkTag = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');

  const usedSlugs = new Set();
  const articleIds = [];
  let publishedCount = 0;
  let draftCount = 0;

  ARTICLES.forEach((a, index) => {
    let slug = slugify(a.title);
    if (usedSlugs.has(slug)) slug = `${slug}-${index}`;
    usedSlugs.add(slug);

    const coverUrl = writeUpload(
      `seed-cover-${slug}.svg`,
      bandsSvg({ width: 1600, height: 800, key: slug, label: a.title, seedNote: 'cover' }),
    );
    const figureUrl = writeUpload(
      `seed-figure-${slug}.svg`,
      bandsSvg({ width: 1400, height: 760, key: `${slug}-fig`, label: `${a.title} — figure`, seedNote: 'figure' }),
    );

    const blocks = a.body.map((b) => (b[0] === 'img' && b[1] === '@figure' ? ['img', figureUrl, b[2]] : b));
    const { html, json } = buildContent(blocks);

    const isDraft = Boolean(a.draft);
    const createdAt = daysAgoIso(150 - index * 6, 7);
    const publishedAt = isDraft ? null : daysAgoIso(148 - index * 6, 10);

    const info = insertArticle.run({
      author_id: userIdByUsername.get(a.author),
      slug,
      title: a.title,
      subtitle: a.subtitle,
      excerpt: deriveExcerpt(html, null),
      cover_url: coverUrl,
      content_json: JSON.stringify(json),
      content_html: html,
      reading_time: deriveReadingTime(html),
      status: isDraft ? 'draft' : 'published',
      published_at: publishedAt,
      created_at: createdAt,
      updated_at: publishedAt || createdAt,
    });

    const articleId = Number(info.lastInsertRowid);
    articleIds.push({ id: articleId, draft: isDraft, authorId: userIdByUsername.get(a.author) });

    for (const tag of a.tags) {
      insertTag.run(tag);
      linkTag.run(articleId, findTag.get(tag).id);
    }

    if (isDraft) draftCount += 1;
    else publishedCount += 1;
  });

  console.log(`  ✓ ${publishedCount} published articles, ${draftCount} drafts`);
  console.log(`  ✓ ${db.prepare('SELECT COUNT(*) AS n FROM tags').get().n} tags`);

  // Engagement — deterministic but non-trivial.
  const insertReaction = db.prepare(
    'INSERT OR IGNORE INTO reactions (user_id, article_id, value, created_at) VALUES (?, ?, ?, ?)',
  );
  const insertSave = db.prepare(
    'INSERT OR IGNORE INTO saves (user_id, article_id, created_at) VALUES (?, ?, ?)',
  );
  const insertReshare = db.prepare(
    'INSERT OR IGNORE INTO reshares (user_id, article_id, comment, created_at) VALUES (?, ?, ?, ?)',
  );

  const RESHARE_NOTES = [
    'This put words to something I have been circling for months.',
    'Required reading for anyone on a rotation right now.',
    'The second half of this is the part I keep coming back to.',
    'Sending this to my team instead of writing the memo myself.',
    'Disagree with the framing, agree with every conclusion.',
    'Best thing I have read on this all quarter.',
    'The bit about the tail is exactly right.',
    null,
  ];

  const allUserIds = [...userIdByUsername.values()];
  let reactionCount = 0;
  let saveCount = 0;
  let reshareCount = 0;

  for (const article of articleIds) {
    if (article.draft) continue;
    // Popularity envelope so the leaderboard has real separation.
    const popularity = 0.25 + rand() * 0.75;

    for (const userId of allUserIds) {
      if (userId === article.authorId) continue;

      if (rand() < popularity * 0.92) {
        const value = rand() < 0.88 ? 1 : -1;
        insertReaction.run(userId, article.id, value, daysAgoIso(Math.floor(rand() * 120), 12));
        reactionCount += 1;
      }
      if (rand() < popularity * 0.45) {
        insertSave.run(userId, article.id, daysAgoIso(Math.floor(rand() * 100), 13));
        saveCount += 1;
      }
      if (rand() < popularity * 0.28) {
        const note = RESHARE_NOTES[Math.floor(rand() * RESHARE_NOTES.length)];
        insertReshare.run(userId, article.id, note, daysAgoIso(Math.floor(rand() * 90), 14));
        reshareCount += 1;
      }
    }
  }

  console.log(`  ✓ ${reactionCount} reactions, ${saveCount} saves, ${reshareCount} reshares`);
  console.log(`  ✓ media written to server/uploads/ (all generated locally, no network)\n`);

  console.log('─────────────────────────────────────────────');
  console.log(' Demo credentials — password for all users:');
  console.log(`   ${DEMO_PASSWORD}`);
  console.log('');
  for (const u of USERS) {
    console.log(`   ${u.email.padEnd(26)} @${u.username}  (${u.name})`);
  }
  console.log('─────────────────────────────────────────────');
  console.log('\n  Next: npm run dev   →   http://localhost:5400\n');
}

run();
