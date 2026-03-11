import { App, Modal, Setting, TFile, Notice } from "obsidian";
import { ParsedFile } from "./parser";

export interface ObjectTypeInfo {
  filePath: string;
  fileLabel: string;
  keyProperty: string;
  /** Union of all property names across all objects in this file */
  properties: string[];
  /** Next auto-increment id */
  nextId: number;
}

/**
 * Derive object type info from parsed files.
 */
export function getObjectTypes(parsedFiles: ParsedFile[]): ObjectTypeInfo[] {
  return parsedFiles.map((pf) => {
    const propSet = new Set<string>();
    let maxId = 0;
    for (const obj of pf.objects) {
      for (const prop of obj.propertyOrder) {
        propSet.add(prop);
      }
      if (obj.id > maxId) maxId = obj.id;
    }
    // Ensure key property is first, id is second, rest in order
    const props: string[] = [];
    propSet.delete(pf.keyProperty);
    propSet.delete("id");
    props.push(pf.keyProperty, "id", ...propSet);

    const fileLabel = pf.objects[0]?.fileLabel
      ?? pf.filePath.replace(/^.*\//, "").replace(/\.md$/i, "");

    return {
      filePath: pf.filePath,
      fileLabel,
      keyProperty: pf.keyProperty,
      properties: props,
      nextId: maxId + 1,
    };
  });
}

/**
 * Modal to create a new object.
 * If objectType is provided, skips the type selection step.
 * If prefillKey is provided, pre-fills the key property value.
 */
export class CreateObjectModal extends Modal {
  private types: ObjectTypeInfo[];
  private selectedType: ObjectTypeInfo | null;
  private prefillKey: string;
  private onCreated: (filePath: string) => void;
  private fieldValues: Map<string, string> = new Map();

  constructor(
    app: App,
    types: ObjectTypeInfo[],
    options?: {
      selectedType?: ObjectTypeInfo;
      prefillKey?: string;
      onCreated?: (filePath: string) => void;
    }
  ) {
    super(app);
    this.types = types;
    this.selectedType = options?.selectedType ?? null;
    this.prefillKey = options?.prefillKey ?? "";
    this.onCreated = options?.onCreated ?? (() => {});
  }

  onOpen(): void {
    this.modalEl.addClass("ol-create-modal");
    this.titleEl.textContent = "Create Object";

    if (this.selectedType) {
      this.renderForm(this.selectedType);
    } else {
      this.renderTypePicker();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /* ── Type Picker ────────────────────────────────────────────────── */

  private renderTypePicker(): void {
    this.contentEl.empty();

    if (this.types.length === 0) {
      this.contentEl.createDiv({
        text: "No object-links files found. Create a file with the object-links tag first.",
        cls: "ol-create-empty",
      });
      return;
    }

    new Setting(this.contentEl)
      .setName("Object type")
      .setDesc("Choose which file to add the object to")
      .addDropdown((dd) => {
        for (const t of this.types) {
          dd.addOption(t.filePath, t.fileLabel);
        }
        dd.onChange((val) => {
          this.selectedType = this.types.find((t) => t.filePath === val) ?? null;
        });
        // Select first by default
        this.selectedType = this.types[0];
      });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText("Next").setCta().onClick(() => {
          if (this.selectedType) this.renderForm(this.selectedType);
        })
      );
  }

  /* ── Object Form ────────────────────────────────────────────────── */

  private renderForm(type: ObjectTypeInfo): void {
    this.contentEl.empty();
    this.fieldValues.clear();
    this.titleEl.textContent = `New ${type.fileLabel}`;

    const form = this.contentEl.createDiv({ cls: "ol-create-form" });

    for (const prop of type.properties) {
      const isKey = prop === type.keyProperty;
      const isId = prop === "id";

      const setting = new Setting(form).setName(prop);

      if (isId) {
        // Auto-filled, read-only
        setting.setDesc(`Auto: ${type.nextId}`);
        this.fieldValues.set("id", String(type.nextId));
        setting.addText((text) =>
          text
            .setValue(String(type.nextId))
            .setDisabled(true)
        );
      } else {
        setting.addText((text) => {
          if (isKey && this.prefillKey) {
            text.setValue(this.prefillKey);
            this.fieldValues.set(prop, this.prefillKey);
          }
          text.setPlaceholder(prop).onChange((val) => {
            this.fieldValues.set(prop, val);
          });
          // Auto-focus key field
          if (isKey) {
            setTimeout(() => text.inputEl.focus(), 50);
          }
        });
      }
    }

    // Submit
    new Setting(form)
      .addButton((btn) =>
        btn.setButtonText("Create").setCta().onClick(() => {
          this.handleCreate(type);
        })
      );

    // Handle Enter key to submit
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleCreate(type);
      }
    });
  }

  /* ── Create Logic ───────────────────────────────────────────────── */

  private async handleCreate(type: ObjectTypeInfo): Promise<void> {
    const keyVal = this.fieldValues.get(type.keyProperty)?.trim();
    if (!keyVal) {
      new Notice(`"${type.keyProperty}" is required.`);
      return;
    }

    // Build the object block
    const lines: string[] = [];
    for (const prop of type.properties) {
      const val = this.fieldValues.get(prop)?.trim() ?? "";
      if (val) {
        lines.push(`${prop}: ${val}`);
      }
    }

    // Ensure key and id are always present
    if (!lines.some((l) => l.startsWith(`${type.keyProperty}:`))) {
      lines.unshift(`${type.keyProperty}: ${keyVal}`);
    }
    if (!lines.some((l) => l.startsWith("id:"))) {
      lines.splice(1, 0, `id: ${type.nextId}`);
    }

    const block = "\n---\n\n" + lines.join("\n");

    // Append to file
    const file = this.app.vault.getAbstractFileByPath(type.filePath);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${type.filePath}`);
      return;
    }

    try {
      const content = await this.app.vault.read(file);
      // Ensure file ends with a newline before appending
      const sep = content.endsWith("\n") ? "" : "\n";
      await this.app.vault.modify(file, content + sep + block + "\n");
      new Notice(`Created "${keyVal}" in ${type.fileLabel}`);
      this.close();
      this.onCreated(type.filePath);
    } catch (err) {
      new Notice(`Failed to create object: ${err}`);
    }
  }
}
