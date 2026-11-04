// コミットの前に、型検査とテストをすべて実行する（仕様書 §19.4）
// どちらかが失敗したら、終了コード 2 でコミットを止める。
import { execSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const command = JSON.parse(input || '{}').tool_input?.command ?? '';
if (!/\bgit\b[^|;&]*\bcommit\b/.test(command)) process.exit(0);

try {
  execSync('npm run --silent check', { cwd: process.env.CLAUDE_PROJECT_DIR, stdio: 'pipe' });
} catch (e) {
  process.stderr.write(`型検査またはテストが通らないため、コミットを止めました。直してからコミットしてください。\n${e.stdout}${e.stderr}`);
  process.exit(2);
}
