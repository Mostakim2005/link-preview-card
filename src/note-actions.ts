import { MarkdownView, Notice, TFile, type Editor } from "obsidian";
import type LinkPreviewCard from "./main";
import { fetchMeta } from "./metadata";
import {
	findBlock,
	findBlocks,
	makeId,
	replaceBlock,
	scanLinks,
	serialize,
} from "./preview-block";
import { cleanTrackingParams, parseUrl } from "./tracker";
import type { PreviewData, ScanItem } from "./types";

export async function flushActiveNote(plugin: LinkPreviewCard, file: TFile): Promise<void> {
	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (view && view.file === file) await view.save();
}

export function getActiveEditorForFile(
	plugin: LinkPreviewCard,
	file: TFile | null,
): Editor | null {
	if (!file) return null;
	const leaves = plugin.app.workspace.getLeavesOfType("markdown");
	for (const leaf of leaves) {
		if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
			return leaf.view.editor;
		}
	}
	return null;
}

export async function applyChanges(
	plugin: LinkPreviewCard,
	file: TFile,
	targets: ScanItem[],
	metas: Map<string, PreviewData>,
): Promise<{ applied: number; failed: number }> {
	let applied = 0;
	let failed = 0;
	await flushActiveNote(plugin, file);

	await plugin.app.vault.process(file, (text) => {
		const newline = text.includes("\r\n") ? "\r\n" : "\n";
		const current = scanLinks(text, plugin.settings.stripTrackers);
		const used = new Set<number>();
		const jobs: ScanItem[] = [];

		for (const target of targets) {
			let idx = current.findIndex(
				(item, i) =>
					!used.has(i) &&
					item.type === target.type &&
					item.url === target.url &&
					item.line === target.line,
			);
			if (idx < 0) {
				idx = current.findIndex(
					(item, i) =>
						!used.has(i) && item.type === target.type && item.url === target.url,
				);
			}
			const found = idx >= 0 ? current[idx] : undefined;
			if (found) {
				used.add(idx);
				jobs.push(found);
			}
		}

		jobs.sort((a, b) => b.line - a.line);
		const lines = text.split(/\r?\n/);
		for (const job of jobs) {
			if (job.type === "preview") {
				lines.splice(job.line, job.end - job.line + 1, job.url);
				applied++;
			} else {
				const meta = metas.get(job.url);
				if (!meta) {
					failed++;
					continue;
				}
				const cleanUrl = plugin.settings.stripTrackers
					? cleanTrackingParams(meta.url)
					: meta.url;
				const block = serialize({
					...meta,
					url: cleanUrl,
					id: makeId(),
					fetchedAt: Date.now(),
				});
				lines.splice(job.line, 1, ...block.split(/\r?\n/));
				applied++;
			}
		}
		return lines.join(newline);
	});

	return { applied, failed };
}

export async function cleanTrackersInFile(
	plugin: LinkPreviewCard,
	file: TFile,
	showNotice = false,
): Promise<number> {
	await flushActiveNote(plugin, file);
	let count = 0;

	await plugin.app.vault.process(file, (text) => {
		const newline = text.includes("\r\n") ? "\r\n" : "\n";
		const lines = text.split(/\r?\n/);
		let changed = false;

		const blocks = findBlocks(text);
		for (const block of blocks.reverse()) {
			const cleanedUrl = cleanTrackingParams(block.data.url);
			if (cleanedUrl !== block.data.url) {
				const nextData = { ...block.data, url: cleanedUrl };
				lines.splice(
					block.start,
					block.end - block.start + 1,
					...serialize(nextData).split(/\r?\n/),
				);
				changed = true;
				count++;
			}
		}

		for (let i = 0; i < lines.length; i++) {
			const raw = lines[i] ?? "";
			if (raw.trim().startsWith("```") || raw.trim().startsWith("~~~")) continue;
			const whole = parseUrl(raw.trim());
			if (whole) {
				const cleaned = cleanTrackingParams(whole.href);
				if (cleaned !== whole.href) {
					lines[i] = cleaned;
					changed = true;
					count++;
				}
			}
		}

		return changed ? lines.join(newline) : text;
	});

	if (showNotice) {
		new Notice(
			count > 0 ? `Cleaned tracking tags from ${count} links` : "No tracking tags found",
		);
	}
	return count;
}


export async function updateBlock(
	plugin: LinkPreviewCard,
	path: string,
	data: PreviewData,
	patch: Partial<PreviewData> | ((current: PreviewData) => Partial<PreviewData>),
): Promise<void> {
	const file = plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return;
	const editor = getActiveEditorForFile(plugin, file);
	if (editor) {
		const text = editor.getValue();
		const hit = findBlock(text, data);
		if (hit) {
			const changes = typeof patch === "function" ? patch(hit.data) : patch;
			const next = { ...hit.data, id: hit.data.id || makeId(), ...changes };
			const startPos = { line: hit.start, ch: 0 };
			const endLineContent = editor.getLine(hit.end) || "";
			const endPos = { line: hit.end, ch: endLineContent.length };
			editor.replaceRange(serialize(next), startPos, endPos);
			return;
		}
	}

	await flushActiveNote(plugin, file);
	await plugin.app.vault.process(file, (text) => {
		const hit = findBlock(text, data);
		if (!hit) return text;
		const changes = typeof patch === "function" ? patch(hit.data) : patch;
		const next = { ...hit.data, id: hit.data.id || makeId(), ...changes };
		return replaceBlock(text, hit, serialize(next));
	});
}

export async function revertBlock(
	plugin: LinkPreviewCard,
	path: string,
	data: PreviewData,
): Promise<void> {
	const file = plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return;
	const editor = getActiveEditorForFile(plugin, file);
	if (editor) {
		const hit = findBlock(editor.getValue(), data);
		if (hit) {
			const startPos = { line: hit.start, ch: 0 };
			const endLineContent = editor.getLine(hit.end) || "";
			const endPos = { line: hit.end, ch: endLineContent.length };
			editor.replaceRange(data.url, startPos, endPos);
			return;
		}
	}

	await flushActiveNote(plugin, file);
	await plugin.app.vault.process(file, (text) => {
		const hit = findBlock(text, data);
		return hit ? replaceBlock(text, hit, data.url) : text;
	});
}

export async function insertPreview(
	plugin: LinkPreviewCard,
	editor: Editor,
	href: string,
	original?: string,
	line?: number,
): Promise<void> {
	const notice = new Notice("Fetching preview…", 15000);
	try {
		const finalUrl = plugin.settings.stripTrackers ? cleanTrackingParams(href) : href;
		const meta = await fetchMeta(finalUrl, plugin.settings.stripTrackers);
		const block =
			serialize({
				...meta,
				url: finalUrl,
				id: makeId(),
				fetchedAt: Date.now(),
			}) + "\n";
		if (line === undefined) {
			editor.replaceSelection(block);
		} else {
			editor.replaceRange(
				block.trimEnd(),
				{ line, ch: 0 },
				{ line, ch: editor.getLine(line).length },
			);
		}
	} catch {
		if (line === undefined && original) editor.replaceSelection(original);
		new Notice("Couldn't load a preview. Kept the plain link.");
	} finally {
		notice.hide();
	}
}
