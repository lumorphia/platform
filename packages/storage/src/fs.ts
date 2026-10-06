import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ObjectStorage, PresignPutInput, PresignedPut, PutInput } from "./types.ts";

type Meta = { contentType: string; cacheControl?: string };

/**
 * 開発用のファイル実装。キーをそのままパスにして root 配下に置くので、サーバーを再起動しても残る。
 * content-type などは `<key>.meta.json` に横置きする。presign は memory と同じくサービスの開発用ルートを指す。
 * サービスの app と worker が同じ root を見れば、どちらからも同じ中身が見える。
 */
export class FsStorage implements ObjectStorage {
  readonly root: string;
  readonly publicBaseUrl: string | null;

  constructor(options: { root: string; publicBaseUrl?: string }) {
    this.root = resolve(options.root);
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/$/, "") ?? null;
  }

  /** root の外に出るキーは拒否する */
  private pathOf(key: string): string {
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`invalid key: ${key}`);
    return p;
  }
  private metaPathOf(key: string): string {
    return `${this.pathOf(key)}.meta.json`;
  }

  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    return {
      url: this.publicBaseUrl
        ? `${this.publicBaseUrl}/${input.key}`
        : `file://${this.pathOf(input.key)}`,
      method: "PUT",
      headers: { "content-type": input.contentType, "content-length": String(input.contentLength) },
      expiresAt: new Date(Date.now() + input.expiresIn * 1000),
    };
  }

  async head(key: string) {
    try {
      const [s, meta] = await Promise.all([stat(this.pathOf(key)), this.readMeta(key)]);
      return {
        contentLength: s.size,
        contentType: meta?.contentType ?? null,
        cacheControl: meta?.cacheControl ?? null,
      };
    } catch {
      return null;
    }
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.pathOf(key)));
    } catch {
      return null;
    }
  }

  async put({ key, body, contentType, cacheControl }: PutInput) {
    const p = this.pathOf(key);
    await mkdir(dirname(p), { recursive: true });
    const meta: Meta = cacheControl ? { contentType, cacheControl } : { contentType };
    await Promise.all([writeFile(p, body), writeFile(this.metaPathOf(key), JSON.stringify(meta))]);
  }

  async delete(keys: readonly string[]) {
    await Promise.all(
      keys.flatMap((key) => [
        rm(this.pathOf(key), { force: true }),
        rm(this.metaPathOf(key), { force: true }),
      ]),
    );
  }

  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (!e.name.endsWith(".meta.json")) {
          const key = relative(this.root, full).split(sep).join("/");
          if (key.startsWith(prefix)) out.push(key);
        }
      }
    };
    await walk(this.root);
    return out.sort();
  }

  private async readMeta(key: string): Promise<Meta | null> {
    try {
      return JSON.parse(await readFile(this.metaPathOf(key), "utf8")) as Meta;
    } catch {
      return null;
    }
  }
}
