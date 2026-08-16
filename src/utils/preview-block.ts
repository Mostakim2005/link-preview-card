import type { Editor, EditorPosition } from 'obsidian';
import type { PreviewBlock, PreviewData } from '../types';

const OPEN = '~~~link-preview';
const CLOSE = '~~~';

export function makeId(): string {
  return `lp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createBlock(data: PreviewData): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...data, fetchedAt: data.fetchedAt ?? Date.now() })) {
    if (value !== '' && value !== undefined && value !== null) clean[key] = value;
  }
  if (Array.isArray(clean.images) && clean.images.length <= 1) delete clean.images;
  return `\n${OPEN}\n${JSON.stringify(clean)}\n${CLOSE}\n`;
}

export function parseBlocks(content: string): PreviewBlock[] {
  const lines = content.split('\n');
  const blocks: PreviewBlock[] = [];
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim();
    if (start < 0 && line === OPEN) { start = index; continue; }
    if (start >= 0 && line === CLOSE) {
      const source = lines.slice(start + 1, index).join('\n');
      try {
        const data = JSON.parse(source) as PreviewData;
        if (typeof data.url === 'string') blocks.push({ startLine: start, endLine: index, source, data });
      } catch { /* malformed block is ignored */ }
      start = -1;
    }
  }
  return blocks;
}

export function blockAtPosition(editor: Editor, position: EditorPosition): PreviewBlock | null {
  return parseBlocks(editor.getValue()).find((block) => position.line >= block.startLine && position.line <= block.endLine) ?? null;
}

export function replaceBlockByIdentity(content: string, block: PreviewBlock, replacement: string): string {
  const lines = content.split('\n');
  lines.splice(block.startLine, block.endLine - block.startLine + 1, ...replacement.trimEnd().split('\n'));
  return lines.join('\n');
}

export function findBlockById(content: string, id: string): PreviewBlock | null {
  return parseBlocks(content).find((block) => block.data.id === id) ?? null;
}
