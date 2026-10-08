export class PollError extends Error {}
export type PollConfig = { title: string; options: { name: string; url: string | null }[]; deadline: string | null; multiple: boolean };

const length = (value: string) => [...value].length;
function text(value: unknown, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new PollError('입력값을 읽을 수 없어요. 새 카드를 열어 다시 입력해 주세요.');
  return value.trim();
}

// 멘션만 보내면 준비 카드, '도움말'은 사용 방법, 그 밖의 글자는 안내와 함께 사용 방법을 보여준다.
export function parseCommand(input: string): 'create' | 'help' | 'invalid' {
  const value = input.replace(/<at>[^<]*<\/at>/gi, '').replace(/&nbsp;/g, ' ').replace(/^\s*@?투표곰/, '').trim();
  return !value ? 'create' : value === '도움말' ? 'help' : 'invalid';
}

const day = 86_400_000;
const kst = 9 * 3_600_000;
function koreanDate(year: number, month: number, date: number, hour: number, minute: number): number {
  const stamp = Date.UTC(year, month - 1, date, hour, minute);
  const check = new Date(stamp);
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date || hour > 23 || minute > 59)
    throw new PollError('존재하지 않는 날짜나 시각이에요 (예: 2월 30일, 25시).');
  return stamp - kst;
}

export function parseDeadline(input: string, now = new Date()): string | null {
  const value = input.trim();
  if (!value) return null;
  if (length(value) > 100) throw new PollError('마감 시간은 100자 이내로 적어주세요.');
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
  } else throw new PollError('마감 시간 형식을 알 수 없어요. 예: 3시간, 금요일 18시, 8월 22일 18시, 2026-10-09 18:00');
  if (!Number.isFinite(stamp) || stamp <= now.getTime() || stamp - now.getTime() > 365 * day)
    throw new PollError('마감 시간은 지금 이후부터 365일 이내로 정해주세요.');
  return new Date(stamp).toISOString();
}

export function validatePoll(input: Record<string, unknown>, now = new Date()): PollConfig {
  const title = text(input.title);
  const rawOptions = text(input.options);
  const deadline = text(input.deadline);
  if (length(title) < 1 || length(title) > 100) throw new PollError('투표 제목은 1~100자로 적어주세요.');
  if (length(title + rawOptions + deadline) > 8_000) throw new PollError('입력 내용이 너무 길어요. 전체 8,000자 이내로 줄여주세요.');
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
      } catch { throw new PollError('후보 링크가 올바르지 않아요. https:// 또는 http://로 시작하는 주소를 괄호 안에 적어주세요.'); }
    }
    if (!name || length(name) > 100) throw new PollError('후보 이름은 1~100자로 적어주세요.');
    return { name, url };
  });
  if (options.length < 2 || options.length > 10) throw new PollError('후보는 2~10개까지 적을 수 있어요.');
  if (new Set(options.map(option => option.name)).size !== options.length) throw new PollError('같은 이름의 후보가 있어요. 후보 이름을 서로 다르게 적어주세요.');
  if (![undefined, false, true, 'true', 'false'].includes(input.multiple as never)) throw new PollError('복수 선택 설정이 올바르지 않아요. 새 카드를 열어주세요.');
  return { title, options, deadline: parseDeadline(deadline, now), multiple: input.multiple === true || input.multiple === 'true' };
}
