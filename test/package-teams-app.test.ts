import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Teams ZIP에 등록 명령과 치환된 manifest, 규격 아이콘만 담는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poll-package-'));
  try {
    cpSync('appPackage', join(dir, 'appPackage'), { recursive: true });
    writeFileSync(join(dir, '.env'), 'MicrosoftAppId=00000000-0000-0000-0000-000000000001\nMicrosoftAppPassword=must-not-be-packaged\n');
    const script = join(process.cwd(), 'scripts/package-teams-app.sh');
    const result = spawnSync('bash', [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const [archive] = readdirSync(join(dir, 'dist'));
    assert.match(archive, /^team-poll-bot-\d{8}-\d{6}\.zip$/);
    const path = join(dir, 'dist', archive);
    assert.deepEqual(spawnSync('unzip', ['-Z1', path], { encoding: 'utf8' }).stdout.trim().split('\n').sort(), ['color.png', 'manifest.json', 'outline.png']);
    const contents = spawnSync('unzip', ['-p', path, 'manifest.json'], { encoding: 'utf8' }).stdout;
    const manifest = JSON.parse(contents);
    assert.equal(manifest.id, '00000000-0000-0000-0000-000000000001');
    assert.equal(manifest.bots[0].botId, manifest.id);
    assert.deepEqual(manifest.bots[0].scopes, ['groupChat']);
    assert.deepEqual(manifest.bots[0].commandLists[0].commands.map((command: { title: string }) => command.title), ['투표만들기', '투표만들기 + 준비곰 목록']);
    assert.ok(!contents.includes('must-not-be-packaged'));
    assert.ok(!contents.includes('{{'));
    for (const [name, size] of [['color', 192], ['outline', 32]] as const) {
      const png = readFileSync(join(dir, 'appPackage', `${name}.png`));
      assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
    }
    writeFileSync(join(dir, '.env'), 'MicrosoftAppId=bad$(id)\n');
    assert.notEqual(spawnSync('bash', [script], { cwd: dir, encoding: 'utf8' }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
