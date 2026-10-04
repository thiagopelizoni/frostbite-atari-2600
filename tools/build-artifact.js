'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'dist', 'frostbite-2600.html');

function localFile(reference) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
    throw new Error(`O artefato offline não aceita dependência externa: ${reference}`);
  }
  const filename = path.resolve(ROOT, decodeURIComponent(reference.split(/[?#]/)[0]));
  if (!filename.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`Dependência fora do projeto: ${reference}`);
  }
  return fs.readFileSync(filename, 'utf8');
}

function buildArtifact() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi, (tag, attributes) => {
    const href = attributes.match(/\bhref=["']([^"']+)["']/i);
    if (!href) throw new Error(`Folha de estilo sem href: ${tag}`);
    const css = localFile(href[1]);
    if (/@import\b|url\(\s*["']?(?:https?:|\/\/)/i.test(css)) {
      throw new Error(`CSS com dependência externa: ${href[1]}`);
    }
    return `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  });
  html = html.replace(/<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)>\s*<\/script>/gi, (_tag, attributes, src) => {
    if (/\btype=["']module["']/i.test(attributes)) {
      throw new Error('O artefato utiliza scripts clássicos sem importações de módulos.');
    }
    return `<script>\n${localFile(src).replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });
  if (!/^\s*<!doctype html>/i.test(html) || !/<html\b/i.test(html) || !/<\/html>\s*$/i.test(html)) {
    throw new Error('index.html precisa ser um documento HTML completo.');
  }
  if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel=["']stylesheet["']/i.test(html)) {
    throw new Error('O artefato ainda possui JavaScript ou CSS externo.');
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, html);
  return { filename: OUTPUT, bytes: Buffer.byteLength(html) };
}

if (require.main === module) {
  const output = buildArtifact();
  console.log(`Gerado dist/frostbite-2600.html (${output.bytes} bytes; funciona offline).`);
}

module.exports = { buildArtifact, ROOT, OUTPUT };
