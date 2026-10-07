export class PollError extends Error {}
export type Prefill = { title?: string; options?: string; deadline?: string; multiple?: boolean };
export type PollConfig = { title: string; options: { name: string; url: string | null }[]; deadline: string | null; multiple: boolean };
export type Command = { type: 'help' } | { type: 'create'; prefill: Prefill } | { type: 'invalid' };

const length = (value: string) => [...value].length;
function text(value: unknown, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new PollError('앗, 입력란에 글자로 적어줘요 🐻');
  return value.trim();
}

export function parseCommand(input: string): Command {
  if (length(input) > 8_000) return { type: 'invalid' };
  const value = input.replace(/<at>[^<]*<\/at>/gi, '').replace(/^\s*@?투표곰\s*/, '').trim();
  if (!value || value === '도움말') return { type: 'help' };
  const match = /^투표만들기(?:\s+([\s\S]*))?$/.exec(value);
  if (!match) return { type: 'invalid' };
  const rest = match[1]?.trim() ?? '';
  if (!rest.startsWith('+')) return { type: 'create', prefill: { title: rest } };
  let tail = rest.slice(1).trim();
  if (!tail || tail === '준비곰 목록') return { type: 'create', prefill: {} };
  try {
    const values: string[] = [];
    while (tail.startsWith('"')) {
      const quoted = /^"(?:\\.|[^"\\])*"/.exec(tail);
      if (!quoted) return { type: 'invalid' };
      values.push(JSON.parse(quoted[0]));
      tail = tail.slice(quoted[0].length).trim();
    }
    const suffix = /^(?:마감:\s*("(?:\\.|[^"\\])*"))?(?:\s*(복수))?$/.exec(tail);
    if (!suffix || values.length < 3 || values.length > 11) return { type: 'invalid' };
    return { type: 'create', prefill: { title: values[0], options: values.slice(1).join('\n'), deadline: suffix[1] ? JSON.parse(suffix[1]) : '', multiple: Boolean(suffix[2]) } };
  } catch { return { type: 'invalid' }; }
}

const day = 86_400_000;
const kst = 9 * 3_600_000;
function koreanDate(year: number, month: number, date: number, hour: number, minute: number): number {
  const stamp = Date.UTC(year, month - 1, date, hour, minute);
  const check = new Date(stamp);
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date || hour > 23 || minute > 59)
    throw new PollError('앗, 달력에 없는 날짜나 시각이에요. 다시 확인해줘요 ⏰');
  return stamp - kst;
}

export function parseDeadline(input: string, now = new Date()): string | null {
  const value = input.trim();
  if (!value) return null;
  if (length(value) > 100) throw new PollError('마감 시간은 짧게 적어줘요 ⏰');
  const today = new Date(now.getTime() + kst);
  let stamp: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d+)(분|시간|일)$/.exec(value))) {
    stamp = now.getTime() + Number(match[1]) * ({ 분: 60_000, 시간: 3_600_000, 일: day }[match[2]]!);
  } else if ((match = /^(월|화|수|목|금|토|일)요일\s+(\d{1,2})(?:시|:(\d{2}))$/.exec(value))) {
    const weekday = '일월화수목금토'.indexOf(match[1]);
    const days = (weekday - today.getUTCDay() + 7) % 7;
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
    stamp = koreanDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), Number(match[2]), Number(match[3] ?? 0));
    if (stamp <= now.getTime()) stamp += 7 * day;
  } else if ((match = /^(\d{1,2})월\s+(\d{1,2})일\s+(\d{1,2})(?:시|:(\d{2}))$/.exec(value))) {
    stamp = koreanDate(today.getUTCFullYear(), Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0));
    if (stamp <= now.getTime()) stamp = koreanDate(today.getUTCFullYear() + 1, Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0));
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(value))) {
    stamp = koreanDate(...match.slice(1).map(Number) as [number, number, number, number, number]);
  } else throw new PollError('마감 시간을 못 알아봤어요. ‘금요일 18시’나 ‘3시간’처럼 적어줘요 ⏰');
  if (!Number.isFinite(stamp) || stamp <= now.getTime() || stamp - now.getTime() > 365 * day)
    throw new PollError('마감은 지금부터 365일 안의 미래 시각으로 정해줘요 ⏰');
  return new Date(stamp).toISOString();
}

export function validatePoll(input: Record<string, unknown>, now = new Date()): PollConfig {
  const title = text(input.title);
  const rawOptions = text(input.options);
  const deadline = text(input.deadline);
  if (length(title) < 1 || length(title) > 100) throw new PollError('투표 이름을 1~100자로 살짝 적어줘요 🐻');
  if (length(title + rawOptions + deadline) > 8_000) throw new PollError('곰 바구니가 가득 찼어요. 입력을 조금 줄여줘요 🧺');
  const options = rawOptions.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const link = /^(.*?)\s*\(([^()]*)\)$/.exec(line);
    let name = line;
    let url: string | null = null;
    if (link && /^(?:[a-z][a-z\d+.-]*:|www\.)/i.test(link[2])) {
      name = link[1].trim();
      try {
        const parsed = new URL(link[2]);
        if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || length(link[2]) > 2_048) throw new Error();
        url = parsed.href;
      } catch { throw new PollError('후보 링크는 올바른 https:// 또는 http:// 주소로 적어줘요 🔗'); }
    }
    if (!name || length(name) > 100) throw new PollError('후보 이름은 1~100자로 적어줘요 🧺');
    return { name, url };
  });
  if (options.length < 2 || options.length > 10) throw new PollError('후보는 2개부터 10개까지 담을 수 있어요 🧺');
  if (new Set(options.map(option => option.name)).size !== options.length) throw new PollError('같은 이름의 후보가 있어요. 서로 알아볼 수 있게 적어줘요 🐾');
  if (![undefined, false, true, 'true', 'false'].includes(input.multiple as never)) throw new PollError('복수 선택 스위치를 다시 확인해줘요 🐾');
  return { title, options, deadline: parseDeadline(deadline, now), multiple: input.multiple === true || input.multiple === 'true' };
}
