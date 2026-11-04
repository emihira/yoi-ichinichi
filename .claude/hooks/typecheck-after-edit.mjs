// Claude Code がファイルを編集・作成した直後に、TypeScript の型検査を行う（仕様書 §19.4）
// エラーがあれば終了コード 2 で Claude Code に内容を伝え、その場で直してもらう。
import { execSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const filePath = JSON.parse(input || '{}').tool_input?.file_path ?? '';
if (!/\.(ts|json)$/.test(filePath)) process.exit(0);

try {
  execSync('npx tsc --noEmit', { cwd: process.env.CLAUDE_PROJECT_DIR, stdio: 'pipe' });
} catch (e) {
  process.stderr.write(`型検査（tsc --noEmit）でエラーが見つかりました。直してください。\n${e.stdout}${e.stderr}`);
  process.exit(2);
}
