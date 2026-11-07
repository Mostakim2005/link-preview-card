import { FENCE_CLOSE, FENCE_OPEN } from "./settings";
import { cleanTrackingParams, parseUrl } from "./tracker";
import type { BlockHit, PreviewData, ScanItem } from "./types";

export function makeId(): string {
	return `lp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clean(obj: PreviewData): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) => v !== "" && v !== undefined && v !== null),
	);
}

export function serialize(data: PreviewData): string {
	return `${FENCE_OPEN}\n${JSON.stringify(clean(data))}\n${FENCE_CLOSE}`;
}

export function findBlocks(text: string): BlockHit[] {
	const lines = text.split(/\r?\n/);
	const out: BlockHit[] = [];
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		const trimmed = (lines[i] ?? "").trim();
		if (start < 0) {
			if (trimmed === FENCE_OPEN) start = i;
			continue;
		}
		if (trimmed === FENCE_CLOSE) {
			try {
				const rawJson = lines.slice(start + 1, i).join("\n");
				const parsed: unknown = JSON.parse(rawJson);
				if (
					typeof parsed === "object" &&
					parsed !== null &&
					typeof (parsed as PreviewData).url === "string"
				) {
					out.push({ start, end: i, data: parsed as PreviewData });
				}
			} catch {
				/* invalid preview block */
			}
			start = -1;
		}
	}
	return out;
}

export function findBlock(text: string, data: PreviewData): BlockHit | null {
	const blocks = findBlocks(text);
	if (data.id) {
		const found = blocks.find((b) => b.data.id === data.id);
		if (found) return found;
	}
	return blocks.find((b) => b.data.url === data.url) ?? null;
}

export function replaceBlock(text: string, block: BlockHit, replacement: string): string {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	lines.splice(block.start, block.end - block.start + 1, ...replacement.split(/\r?\n/));
	return lines.join(newline);
}

export function scanLinks(text: string, stripTrackers = false): ScanItem[] {
	const lines = text.split(/\r?\n/);
	const owner = new Map<number, BlockHit>();
	for (const b of findBlocks(text)) {
		for (let i = b.start; i <= b.end; i++) owner.set(i, b);
	}

	const items: ScanItem[] = [];
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		const block = owner.get(i);
		if (block) {
			if (i === block.start) {
				items.push({
					type: "preview",
					line: block.start,
					end: block.end,
					url: block.data.url,
					title: block.data.alias || block.data.title || "",
				});
			}
			continue;
		}

		const raw = (lines[i] ?? "").trim();
		if (raw.startsWith("```") || raw.startsWith("~~~")) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;

		// Strip markdown list markers so list items can be converted.
		const cleanLine = raw.replace(/^(\s*[-*+]|\s*\d+\.)\s+/, "");
		const whole = parseUrl(cleanLine);
		if (whole) {
			const targetUrl = stripTrackers ? cleanTrackingParams(whole.href) : whole.href;
			items.push({ type: "link", line: i, end: i, url: targetUrl });
			continue;
		}
		for (const match of raw.matchAll(/https?:\/\/[^\s<>()"'\]]+/gi)) {
			const token = match[0] ?? "";
			const u = parseUrl(token.replace(/[.,;:!?]+$/, ""));
			if (u) {
				const targetUrl = stripTrackers ? cleanTrackingParams(u.href) : u.href;
				items.push({ type: "inline", line: i, end: i, url: targetUrl });
			}
		}
	}
	return items;
}

export function insideFence(editor: { getCursor(): { line: number }; getLine(line: number): string }): boolean {
	let open = false;
	for (let i = 0; i <= editor.getCursor().line; i++) {
		const t = editor.getLine(i).trim();
		if (t.startsWith("```") || t.startsWith("~~~")) open = !open;
	}
	return open;
}

