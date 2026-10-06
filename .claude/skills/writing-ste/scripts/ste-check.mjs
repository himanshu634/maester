#!/usr/bin/env node
// Mechanical ASD-STE100 checks for a Markdown file. It finds what a pattern can find:
// sentence and paragraph length, verb forms, semicolons, Latin abbreviations and the
// words in references/words.md. Noun clusters, word meaning and one instruction per
// step need a person (see SKILL.md, step 5). Exit code 1 when there is an error.
//
//   node .claude/skills/writing-ste/scripts/ste-check.mjs <file.md> [...]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LIMIT = { procedural: 20, descriptive: 25 };
const MAX_PARAGRAPH_SENTENCES = 6;

// "-ing" words that are not verb forms.
const ING_OK = new Set(
	'thing things nothing something anything everything during string strings ring spring bring brings king ceiling morning evening wing wings sibling siblings warning warnings heading headings setting settings building buildings meaning meanings ending endings beginning padding bearing'.split(
		' '
	)
);
const BE = '(?:is|are|was|were|be|been|being)';
const HAVE = '(?:has|have|had)';
const IRREGULAR =
	'(?:done|made|sent|shown|given|taken|written|read|run|set|put|kept|left|found|built|held|known|seen|chosen|drawn|thrown|broken|begun|got|gotten|hidden|split|cut|shut|lost|paid|sold|told|won)';
const PARTICIPLE = `(?:\\w+ed|${IRREGULAR})`;

function loadWords() {
	const text = readFileSync(join(here, '..', 'references', 'words.md'), 'utf8');
	const rows = [];
	for (const line of text.split('\n')) {
		const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
		if (!m || m[1] === 'Do not use' || /^-+$/.test(m[1])) continue;
		const word = m[1].toLowerCase();
		const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const tail = /\w$/.test(word) ? '\\b' : '';
		rows.push({ word, use: m[2], re: new RegExp(`\\b${escaped}${tail}`, 'gi') });
	}
	return rows;
}

// Replace code, links and markup with plain words, keeping the line count.
function clean(line) {
	return line
		.replace(/`[^`]*`/g, 'CODE')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<https?:[^>]+>/g, 'URL')
		.replace(/https?:\/\/\S+/g, 'URL')
		.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1');
}

function countWords(sentence) {
	return sentence
		.replace(/[—–]/g, ' ')
		.split(/\s+/)
		.filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Split on . ! ? and on : when a list or clause follows. Keeps "1.5" and "v2.1" whole.
function sentences(text) {
	return text
		.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(`])|(?<=:)\s+(?=[A-Z])/)
		.map((s) => s.trim())
		.filter((s) => countWords(s) > 0);
}

function blocks(source) {
	const lines = source.split('\n');
	const out = [];
	let fence = false;
	let frontMatter = lines[0] === '---';
	let para = null;
	let section = '';
	const flush = () => {
		if (para) out.push(para);
		para = null;
	};
	lines.forEach((raw, i) => {
		const n = i + 1;
		if (frontMatter) {
			if (i > 0 && raw === '---') frontMatter = false;
			return;
		}
		if (/^\s*(```|~~~)/.test(raw)) {
			fence = !fence;
			flush();
			return;
		}
		if (fence || /^\s*<!--/.test(raw)) return;
		const line = clean(raw);
		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			flush();
			section = heading[2];
			out.push({ kind: 'heading', text: heading[2], line: n, section });
			return;
		}
		if (/^\s*\|/.test(line)) {
			flush();
			if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
			for (const cell of line.split('|').slice(1, -1)) {
				out.push({ kind: 'cell', text: cell.trim(), line: n, section });
			}
			return;
		}
		const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
		const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
		if (ordered || bullet) {
			flush();
			para = { kind: ordered ? 'step' : 'item', text: (ordered || bullet)[1], line: n, section };
			return;
		}
		if (line.trim() === '') {
			flush();
			return;
		}
		if (para) para.text += ' ' + line.trim();
		else para = { kind: 'para', text: line.trim(), line: n, section };
	});
	flush();
	return out;
}

// Procedural text sits under a "Procedures" or "To …" heading. A numbered list elsewhere
// (the Operation section) is descriptive.
function isProcedural(block) {
	const heading = block.section.replace(/^\d+(?:\.\d+)*\.?\s+/, '');
	return /^(to |procedures?\b|how to)/i.test(heading);
}

function check(file, words) {
	const findings = [];
	const add = (line, level, rule, message) => findings.push({ line, level, rule, message });

	for (const b of blocks(readFileSync(file, 'utf8'))) {
		const text = b.text;
		if (/;/.test(text)) add(b.line, 'error', 'punctuation', 'Semicolon. Make two sentences or a list.');

		for (const w of words) {
			for (const m of text.matchAll(w.re)) add(b.line, 'warn', 'word', `"${m[0]}": use ${w.use}.`);
		}

		const flagged = new Set();
		for (const m of text.matchAll(new RegExp(`\\b${BE}\\s+(?:not\\s+)?(\\w+ing)\\b`, 'gi'))) {
			if (ING_OK.has(m[1].toLowerCase())) continue;
			flagged.add(m[1].toLowerCase());
			add(b.line, 'error', 'verb', `"${m[0]}": progressive tense. Use the simple present or past.`);
		}
		for (const m of text.matchAll(new RegExp(`\\b${HAVE}\\s+(?:not\\s+)?(?:been\\s+)?${PARTICIPLE}\\b`, 'gi'))) {
			add(b.line, 'error', 'verb', `"${m[0]}": perfect tense. Use the simple past or present.`);
		}
		for (const m of text.matchAll(/\b[A-Za-z]+ing\b/g)) {
			const word = m[0].toLowerCase();
			if (ING_OK.has(word) || flagged.has(word) || (/^[A-Z]/.test(m[0]) && m.index > 0)) continue;
			add(b.line, 'warn', 'verb', `"${m[0]}": -ing form. Keep it only inside a technical noun.`);
		}
		for (const m of text.matchAll(new RegExp(`\\b(?<!${HAVE}\\s)${BE}\\s+(?:not\\s+)?${PARTICIPLE}\\b`, 'gi'))) {
			const level = isProcedural(b) ? 'error' : 'warn';
			add(b.line, level, 'voice', `"${m[0]}": passive. Say who or what does it.`);
		}

		if (b.kind === 'heading' || b.kind === 'cell') continue;

		const all = sentences(text);
		const limit = isProcedural(b) ? LIMIT.procedural : LIMIT.descriptive;
		for (const s of all) {
			const count = countWords(s);
			if (count > limit) {
				const kind = limit === LIMIT.procedural ? 'procedural' : 'descriptive';
				add(b.line, 'error', 'length', `${count} words, ${kind} maximum ${limit}: "${s.slice(0, 60)}…"`);
			}
		}
		if (b.kind === 'para' && all.length > MAX_PARAGRAPH_SENTENCES) {
			add(b.line, 'error', 'paragraph', `${all.length} sentences. Maximum ${MAX_PARAGRAPH_SENTENCES}.`);
		}
		if (b.kind === 'step' && isProcedural(b) && all.length > 1) {
			add(b.line, 'warn', 'procedure', `${all.length} sentences in one step. One instruction for each step.`);
		}
	}
	return findings.sort((a, b) => a.line - b.line);
}

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('Usage: node ste-check.mjs <file.md> [...]');
	process.exit(2);
}
const words = loadWords();
let errors = 0;
let warnings = 0;
for (const file of files) {
	for (const f of check(file, words)) {
		console.log(`${file}:${f.line}: ${f.level} [${f.rule}] ${f.message}`);
		if (f.level === 'error') errors++;
		else warnings++;
	}
}
console.log(`\n${errors} error(s), ${warnings} warning(s).`);
process.exit(errors > 0 ? 1 : 0);
