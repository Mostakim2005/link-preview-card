import { Modal, Notice } from 'obsidian';

export class UrlSelectionModal extends Modal {
  private selected = new Set<string>();
  private listEl!: HTMLDivElement;
  private readonly rows: HTMLInputElement[] = [];

  constructor(app: import('obsidian').App, private readonly urls: string[], private readonly onSubmit: (urls: string[]) => void) {
    super(app);
    for (const url of urls) this.selected.add(url);
  }

  override onOpen(): void {
    this.contentEl.empty();
    this.titleEl.setText('Choose links to preview');
    this.listEl = this.contentEl.createDiv({ cls: 'link-preview-selection-list' });
    for (const url of this.urls) {
      const row = this.listEl.createDiv({ cls: 'link-preview-selection-row' });
      const input = row.createEl('input', { type: 'checkbox' });
      input.checked = true;
      input.ariaLabel = url;
      input.addEventListener('change', () => input.checked ? this.selected.add(url) : this.selected.delete(url));
      this.rows.push(input);
      row.createSpan({ text: url });
    }
    const controls = this.contentEl.createDiv({ cls: 'link-preview-modal-controls' });
    controls.createEl('button', { text: 'Select all' }).addEventListener('click', () => {
      for (const input of this.rows) input.checked = true;
      this.selected = new Set(this.urls);
    });
    controls.createEl('button', { text: 'Select none' }).addEventListener('click', () => {
      for (const input of this.rows) input.checked = false;
      this.selected.clear();
    });
    const insert = controls.createEl('button', { text: 'Insert previews', cls: 'mod-cta' });
    insert.addEventListener('click', () => {
      if (!this.selected.size) { new Notice('No links selected'); return; }
      const selected = this.urls.filter((url) => this.selected.has(url));
      this.close();
      this.onSubmit(selected);
    });
  }

  override onClose(): void { this.contentEl.empty(); }
}
