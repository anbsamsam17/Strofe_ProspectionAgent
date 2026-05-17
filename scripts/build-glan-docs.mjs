// =============================================================================
// scripts/build-glan-docs.mjs
//
// Convertit les deux Markdown sources (docs/glan-doc-*.md) en PDF stylés
// via marked + Chrome headless. Ne dépend que de :
//   - marked (déjà installé en transitif, v15)
//   - Google Chrome installé sur la machine (Windows : C:\Program Files\Google\Chrome\Application\chrome.exe)
//
// Usage :
//   node scripts/build-glan-docs.mjs
//
// Output :
//   docs/glan-doc-technique.pdf
//   docs/glan-doc-commerciale.pdf
// =============================================================================

import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { marked } from 'marked'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DOCS = join(ROOT, 'docs')

const SOURCES = [
  {
    md: join(DOCS, 'glan-doc-technique.md'),
    pdf: join(DOCS, 'glan-doc-technique.pdf'),
    title: 'Glan — Architecture & Pipelines',
    variant: 'technique',
  },
  {
    md: join(DOCS, 'glan-doc-commerciale.md'),
    pdf: join(DOCS, 'glan-doc-commerciale.pdf'),
    title: 'Glan — Présentation commerciale',
    variant: 'commerciale',
  },
]

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path, fsConstants.X_OK)
      return path
    } catch {
      // continue
    }
  }
  throw new Error(
    'Aucun Chrome/Edge trouvé. Installez Google Chrome ou ajustez CHROME_CANDIDATES.',
  )
}

function buildHtml({ bodyHtml, title, variant }) {
  // Palette alignée memory/project_design_tokens.md (navy + brand + or, OKLCH).
  const isCommercial = variant === 'commerciale'
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page {
    size: A4;
    margin: 22mm 18mm 22mm 18mm;
  }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a;
    line-height: 1.55;
    font-size: 10.5pt;
  }
  body {
    margin: 0;
    background: #ffffff;
  }
  h1 {
    color: #0b1e3f;
    font-size: 22pt;
    margin: 0 0 0.35em 0;
    padding-bottom: 0.4em;
    border-bottom: 3px solid ${isCommercial ? '#c89b3a' : '#1f3a8a'};
    letter-spacing: -0.01em;
    line-height: 1.15;
  }
  h2 {
    color: #1f3a8a;
    font-size: 14.5pt;
    margin-top: 1.6em;
    margin-bottom: 0.4em;
    padding-bottom: 0.2em;
    border-bottom: 1px solid #e2e8f0;
    page-break-after: avoid;
    line-height: 1.25;
  }
  h3 {
    color: #1f3a8a;
    font-size: 12pt;
    margin-top: 1.2em;
    margin-bottom: 0.3em;
    page-break-after: avoid;
  }
  h4 {
    color: #334155;
    font-size: 11pt;
    margin-top: 1em;
    margin-bottom: 0.25em;
    page-break-after: avoid;
  }
  p, li {
    color: #1e293b;
    margin: 0.4em 0;
  }
  ul, ol {
    padding-left: 1.4em;
    margin: 0.4em 0;
  }
  li {
    margin: 0.15em 0;
  }
  strong {
    color: #0b1e3f;
    font-weight: 600;
  }
  code {
    font-family: "JetBrains Mono", "Fira Code", Consolas, "Cascadia Code", monospace;
    font-size: 9pt;
    background: #f1f5f9;
    padding: 0.08em 0.35em;
    border-radius: 3px;
    color: #1e293b;
  }
  pre {
    background: #0b1e3f;
    color: #e2e8f0;
    padding: 0.9em 1.1em;
    border-radius: 6px;
    font-size: 8.8pt;
    line-height: 1.45;
    overflow-x: auto;
    page-break-inside: avoid;
  }
  pre code {
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: inherit;
  }
  blockquote {
    border-left: 4px solid ${isCommercial ? '#c89b3a' : '#1f3a8a'};
    background: ${isCommercial ? '#fdf6e3' : '#eef2ff'};
    color: #1e293b;
    margin: 0.8em 0;
    padding: 0.6em 1em;
    font-style: italic;
    page-break-inside: avoid;
  }
  blockquote p { margin: 0.2em 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.8em 0;
    font-size: 9.6pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 0.45em 0.6em;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: ${isCommercial ? '#0b1e3f' : '#1f3a8a'};
    color: #ffffff;
    font-weight: 600;
  }
  tbody tr:nth-child(even) td {
    background: #f8fafc;
  }
  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 1.6em 0;
  }
  a {
    color: #1f3a8a;
    text-decoration: none;
  }
  /* Premier blockquote (sous le titre) = baseline / accroche */
  h1 + blockquote {
    border-left-width: 5px;
    font-size: 11.5pt;
    background: ${isCommercial ? '#fdf6e3' : '#f1f5f9'};
  }
  /* Footer auto avec signature */
  .glan-footer {
    margin-top: 2em;
    padding-top: 0.8em;
    border-top: 1px solid #e2e8f0;
    color: #64748b;
    font-size: 8.5pt;
    text-align: right;
  }
</style>
</head>
<body>
${bodyHtml}
<div class="glan-footer">Document généré le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })} — ProspectionAgent · Glan</div>
</body>
</html>`
}

function runChrome(chromePath, htmlFileUrl, pdfPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      htmlFileUrl,
    ]
    const child = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Chrome headless exit ${code}\n${stderr}`))
    })
  })
}

async function main() {
  console.log('[build-glan-docs] Démarrage...')
  const chromePath = await findChrome()
  console.log(`[build-glan-docs] Chrome trouvé : ${chromePath}`)
  await mkdir(DOCS, { recursive: true })

  for (const src of SOURCES) {
    console.log(`\n[build-glan-docs] → ${basename(src.md)}`)
    const md = await readFile(src.md, 'utf8')
    const bodyHtml = marked.parse(md, { gfm: true, breaks: false })
    const html = buildHtml({ bodyHtml, title: src.title, variant: src.variant })

    const tmpHtml = join(tmpdir(), `glan-${src.variant}-${Date.now()}.html`)
    await writeFile(tmpHtml, html, 'utf8')
    const tmpHtmlUrl = pathToFileURL(tmpHtml).toString()

    try {
      await runChrome(chromePath, tmpHtmlUrl, src.pdf)
      console.log(`[build-glan-docs]   PDF généré : ${src.pdf}`)
    } finally {
      await unlink(tmpHtml).catch(() => {})
    }
  }

  console.log('\n[build-glan-docs] Terminé.')
}

main().catch((err) => {
  console.error('[build-glan-docs] ERREUR :', err)
  process.exit(1)
})
