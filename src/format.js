import { formatUnits } from './hex.js';
import { revokeCalldata } from './approvals.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = c('31;1'), magenta = c('35;1'), yellow = c('33'), green = c('32'), dim = c('2'), bold = c('1');
export const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
export const ICON = { ZOMBIE: '🧟', GHOST: '👻', STALE: '🕸️', ALIVE: '🟢' };
const paint = { ZOMBIE: red, GHOST: magenta, STALE: yellow, ALIVE: green };

export function describeAmount(a) {
  if (a.kind === 'all') return 'ALL (approvalForAll)';
  if (a.kind === 'nft') return `NFT #${a.tokenId}`;
  if (a.unlimited) return 'Unlimited';
  return a.decimals == null ? a.amount.toString() : formatUnits(a.amount, a.decimals);
}

export function age(ts, now = Date.now() / 1000) {
  if (!ts) return '?';
  const d = Math.floor((now - ts) / 86400);
  if (d < 1) return 'today';
  if (d < 60) return `${d}d`;
  if (d < 730) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

const tokenLabel = (a) => a.symbol || a.tokenName || short(a.token);
const spenderLabel = (a) => (a.spenderName ? `${a.spenderName} (${short(a.spender)})` : a.spender);

export function summaryLine(r) {
  const n = r.counts;
  return `${r.chain}: ${n.ZOMBIE} zombie · ${n.GHOST} ghost · ${n.STALE} stale · ${n.ALIVE} alive (${r.approvals.length} live approvals)`;
}

export function renderReport(r, { showCalldata = false, showAll = false } = {}) {
  const lines = [];
  lines.push(bold(`🧟 zombiescan · ${r.chain} · ${short(r.owner)}`));
  lines.push(dim(`source: ${r.source}${r.fullHistory ? '' : '  (older approvals need --days N or ETHERSCAN_API_KEY)'} · ${r.events} approval events · stale after ${r.staleDays}d`));
  lines.push('');
  if (!r.approvals.length) { lines.push(green('✓ No live approvals at all. Nothing is haunting this wallet.')); return lines.join('\n'); }
  const shown = r.approvals.filter((a) => showAll || a.level !== 'ALIVE');
  if (!shown.length) lines.push(green(`✓ No ghosts. All ${r.approvals.length} live approvals go to contracts that are still alive.`));
  else {
    lines.push(dim(['LEVEL ', 'TOKEN'.padEnd(12), 'ALLOWANCE'.padEnd(20), 'AGE'.padStart(5), '  SPENDER'].join('  ')));
    for (const a of shown) {
      lines.push([paint[a.level](a.level.padEnd(6)), tokenLabel(a).slice(0, 12).padEnd(12), describeAmount(a).slice(0, 20).padEnd(20), age(a.timestamp).padStart(5), '  ' + spenderLabel(a)].join('  '));
      lines.push(dim('        ↳ ' + a.reasons.join('; ')));
      if (showCalldata) { const t = revokeCalldata(a); lines.push(dim(`        revoke: ${t.fn} → to ${t.to} data ${t.data}`)); }
    }
  }
  lines.push('');
  const n = r.counts;
  lines.push(`${red(n.ZOMBIE + ' zombie')} · ${magenta(n.GHOST + ' ghost')} · ${yellow(n.STALE + ' stale')} · ${green(n.ALIVE + ' alive')}${!showAll && n.ALIVE ? dim('  (--all to list alive ones)') : ''}`);
  if (shown.length) lines.push(dim(`Revoke in one place: https://revoke.cash/address/${r.owner}?chainId=${r.chainId}  (or --calldata)`));
  return lines.join('\n');
}

export function toJSON(r) {
  return JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

export function toMarkdown(r, { showCalldata = false, showAll = false } = {}) {
  const out = [`### ${r.chain} · \`${r.owner}\``, '', `Source: ${r.source} · ${r.events} approval events · stale after ${r.staleDays}d`, '',
    `**${r.counts.ZOMBIE}** 🧟 zombie · **${r.counts.GHOST}** 👻 ghost · **${r.counts.STALE}** 🕸️ stale · **${r.counts.ALIVE}** 🟢 alive`, ''];
  if (!r.approvals.length) return out.concat('✅ No live approvals at all. Nothing is haunting this wallet.').join('\n');
  const shown = r.approvals.filter((a) => showAll || a.level !== 'ALIVE');
  if (!shown.length) return out.concat(`✅ No ghosts. All ${r.approvals.length} live approvals go to contracts that are still alive.`).join('\n');
  out.push(`| Level | Token | Allowance | Spender | Age | Why |${showCalldata ? ' Revoke calldata |' : ''}`, `|---|---|---|---|---|---|${showCalldata ? '---|' : ''}`);
  for (const a of shown) {
    const t = revokeCalldata(a);
    out.push(`| ${ICON[a.level]} ${a.level} | ${tokenLabel(a)} | ${describeAmount(a)} | ${a.spenderName ? a.spenderName + ' ' : ''}\`${a.spender}\` | ${age(a.timestamp)} | ${a.reasons.join('; ')} |${showCalldata ? ` to \`${t.to}\` data \`${t.data}\` |` : ''}`);
  }
  out.push('', `[Revoke on revoke.cash](https://revoke.cash/address/${r.owner}?chainId=${r.chainId})`);
  return out.join('\n');
}
