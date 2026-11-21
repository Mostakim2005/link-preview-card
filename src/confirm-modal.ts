import { App, Modal } from "obsidian";

export interface ConfirmModalOptions {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	cssPrefix?: string;
	onConfirm: () => void | Promise<void>;
}

export class ConfirmModal extends Modal {
	constructor(app: App, private readonly options: ConfirmModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		const prefix = this.options.cssPrefix ?? "uiux";
		contentEl.empty();
		contentEl.addClass(`${prefix}-root`);
		contentEl.createEl("h3", { text: this.options.title });
		contentEl.createEl("p", {
			text: this.options.message,
			cls: `${prefix}-confirm-message`,
		});

		const actions = contentEl.createDiv({ cls: `${prefix}-confirm-actions` });
		const cancelBtn = actions.createEl("button", {
			text: this.options.cancelLabel ?? "Cancel",
			attr: { type: "button" },
		});
		cancelBtn.addEventListener("click", () => this.close());

		const confirmBtn = actions.createEl("button", {
			text: this.options.confirmLabel ?? "Confirm",
			cls: this.options.destructive ? "mod-warning" : "mod-cta",
			attr: { type: "button" },
		});
		confirmBtn.addEventListener("click", () => {
			this.close();
			void this.options.onConfirm();
		});
		cancelBtn.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
