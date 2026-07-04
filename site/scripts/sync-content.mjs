// Copies the Markdown in /topics (the source of truth) into Starlight's
// content dir, adding the frontmatter Starlight needs (title, sidebar order/label).
// Run automatically by `npm run dev` and `npm run build`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..'); // site/scripts -> repo root
const topicsDir = path.join(repoRoot, 'topics');
const docsDir = path.join(repoRoot, 'site', 'src', 'content', 'docs');

const orderByFile = { lesson: 1, exercises: 2 };
const labelByFile = { lesson: 'Lesson', exercises: 'Exercises & Solutions' };

const prettify = (name) => name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const yamlEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const fmValue = (v) => (typeof v === 'number' ? String(v) : `"${yamlEscape(v)}"`);

function frontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 == null) continue;
        lines.push(`  ${k2}: ${fmValue(v2)}`);
      }
    } else {
      lines.push(`${k}: ${fmValue(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function deriveTitle(raw, fallback) {
  const m = raw.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : fallback;
}

function stripFirstH1(raw) {
  const lines = raw.split('\n');
  const idx = lines.findIndex((l) => /^#\s+/.test(l));
  if (idx === -1) return raw;
  lines.splice(idx, 1);
  if (lines[idx] !== undefined && lines[idx].trim() === '') lines.splice(idx, 1);
  return lines.join('\n');
}

async function writeDoc(destRel, srcAbs, { titleFallback, order, label }) {
  const raw = await fs.readFile(srcAbs, 'utf8');
  const title = deriveTitle(raw, titleFallback);
  const body = stripFirstH1(raw).trimStart();
  const sidebar = order != null || label != null ? { order, label } : undefined;
  const fm = frontmatter({ title, sidebar });
  const dest = path.join(docsDir, destRel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, `${fm}\n\n${body}\n`);
}

async function cleanGenerated() {
  const entries = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isDirectory() && e.name.startsWith('topic-')) {
      await fs.rm(path.join(docsDir, e.name), { recursive: true, force: true });
    }
  }
  for (const f of ['guide.md', 'commands.md', 'setup.md']) {
    await fs.rm(path.join(docsDir, f), { force: true });
  }
}

async function main() {
  await fs.mkdir(docsDir, { recursive: true });
  await cleanGenerated();

  // Top-level guides (labels come from the sidebar config, so no per-file label)
  await writeDoc('guide.md', path.join(topicsDir, 'README.md'), {
    titleFallback: 'Guide',
  });
  await writeDoc('commands.md', path.join(repoRoot, 'COMMANDS.md'), {
    titleFallback: 'Commands',
  });
  await writeDoc('setup.md', path.join(repoRoot, 'README.md'), {
    titleFallback: 'Setup',
  });

  // Topic folders
  const topics = (await fs.readdir(topicsDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name.startsWith('topic-'))
    .map((e) => e.name)
    .sort();

  let count = 0;
  for (const topic of topics) {
    const files = (await fs.readdir(path.join(topicsDir, topic))).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const base = file.replace(/\.md$/, '');
      await writeDoc(path.join(topic, file), path.join(topicsDir, topic, file), {
        titleFallback: prettify(base),
        order: orderByFile[base] ?? 4,
        label: labelByFile[base] ?? prettify(base),
      });
      count++;
    }
  }

  console.log(`Synced ${count} topic pages + 3 guides into ${path.relative(repoRoot, docsDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
