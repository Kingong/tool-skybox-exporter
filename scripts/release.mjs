/**
 * 一键发布脚本：检查工作区干净 → 读取版本 → 打 tag → 推送触发 GitHub Actions Release。
 * 用法：pnpm release        # 发布当前版本
 *       pnpm release 0.2.0  # 指定新版本（自动改 package.json + commit）
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const requestedVersion = process.argv[2];
const version = requestedVersion || pkg.version;
const tag = `v${version}`;

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', ...opts }).trim();
}

function runInherit(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

// 1. 如果指定了新版本，先更新 package.json 并提交
if (requestedVersion && requestedVersion !== pkg.version) {
  console.log(`\n📦 Updating version: ${pkg.version} → ${requestedVersion}`);
  pkg.version = requestedVersion;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  runInherit(`git add package.json && git commit -m "chore: release ${requestedVersion}"`);
}

// 2. 检查工作区是否干净
const status = run('git status --porcelain');
if (status) {
  console.error('\n❌ Working tree not clean. Commit or stash first:\n');
  console.error(status);
  process.exit(1);
}

// 3. 检查 tag 是否已存在
const existingTags = run('git tag -l');
if (existingTags.split('\n').includes(tag)) {
  console.error(`\n❌ Tag ${tag} already exists.`);
  console.error('   To redo: git tag -d ' + tag + ' && git push origin :refs/tags/' + tag);
  process.exit(1);
}

// 4. 推送最新 main（确保 tag 指向最新代码）
const remote = run('git remote get-url origin-github 2>/dev/null || git remote get-url origin');
console.log(`\n🚀 Remote: ${remote}`);

runInherit('git push origin-github main 2>/dev/null || git push origin main');

// 5. 打 tag 并推送触发 Actions
console.log(`\n🏷️  Creating tag ${tag}...`);
runInherit(`git tag ${tag} && git push origin-github ${tag} 2>/dev/null || git push origin ${tag}`);

console.log(`\n✅ Tag ${tag} pushed. GitHub Actions will build and create the Release.`);
console.log(`   https://github.com/Kingong/tool-skybox-exporter/actions`);
console.log(`   https://github.com/Kingong/tool-skybox-exporter/releases/tag/${tag}`);
