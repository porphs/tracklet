/** Where the database bytes live between launches. */
export interface Persistence {
  readonly kind: "tauri" | "browser" | "memory";
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
  /** Copies the saved database to a named backup. Returns false if there was nothing to copy. */
  createBackup(name: string): Promise<boolean>;
  listBackups(): Promise<string[]>;
  deleteBackup(name: string): Promise<void>;
  /** Human-readable location of the data, for Settings. */
  location(): Promise<string>;
  /** Saves an export file where the user can find it; returns where it went. */
  exportFile(name: string, contents: string): Promise<string>;
  /** Shows a saved file in Finder, when possible. */
  reveal(path: string): Promise<void>;
}

/** Browser preview: hands the file to the browser as a download. */
function browserDownload(name: string, contents: string): string {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `Downloads/${name} (browser download)`;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function tauriPersistence(): Promise<Persistence> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    kind: "tauri",
    async load() {
      const buf = await invoke<ArrayBuffer>("db_read");
      const bytes = new Uint8Array(buf);
      return bytes.length ? bytes : null;
    },
    async save(bytes) {
      await invoke("db_write", bytes);
    },
    createBackup: (name) => invoke<boolean>("backup_create", { name }),
    listBackups: () => invoke<string[]>("backup_list"),
    deleteBackup: (name) => invoke("backup_delete", { name }),
    location: () => invoke<string>("data_dir_path"),
    exportFile: (name, contents) => invoke<string>("export_write", { name, contents }),
    reveal: (path) => invoke("reveal_path", { path }),
  };
}

/** In-memory storage (tests, and the browser preview with ?memory). */
export function memoryPersistence(initial: Uint8Array | null = null): Persistence & {
  saved: Uint8Array | null;
  backups: Map<string, Uint8Array>;
  exports: Map<string, string>;
} {
  const p = {
    kind: "memory" as const,
    saved: initial,
    backups: new Map<string, Uint8Array>(),
    async load() {
      return p.saved;
    },
    async save(bytes: Uint8Array) {
      p.saved = bytes.slice();
    },
    async createBackup(name: string) {
      if (!p.saved) return false;
      p.backups.set(name, p.saved.slice());
      return true;
    },
    async listBackups() {
      return [...p.backups.keys()];
    },
    async deleteBackup(name: string) {
      p.backups.delete(name);
    },
    async location() {
      return "memory (not saved)";
    },
    exports: new Map<string, string>(),
    async exportFile(name: string, contents: string) {
      p.exports.set(name, contents);
      return `memory:${name}`;
    },
    async reveal() {},
  };
  return p;
}

const LS_KEY = "tracklet.db";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Browser preview storage (development only): the database in localStorage. */
export function browserPersistence(): Persistence {
  const get = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  return {
    kind: "browser",
    async load() {
      const v = get(LS_KEY);
      return v ? fromBase64(v) : null;
    },
    async save(bytes) {
      localStorage.setItem(LS_KEY, toBase64(bytes));
    },
    async createBackup(name) {
      const v = get(LS_KEY);
      if (!v) return false;
      localStorage.setItem(`${LS_KEY}.backup.${name}`, v);
      return true;
    },
    async listBackups() {
      const prefix = `${LS_KEY}.backup.`;
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
    async deleteBackup(name) {
      localStorage.removeItem(`${LS_KEY}.backup.${name}`);
    },
    async location() {
      return "browser localStorage (development preview)";
    },
    async exportFile(name, contents) {
      return browserDownload(name, contents);
    },
    async reveal() {},
  };
}
