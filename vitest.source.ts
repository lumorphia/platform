/**
 * テストはこのリポジトリのパッケージ (@lumorphia/*) をビルドせずソースから読む。exports の "source" 条件。
 * Node の実行は "default" (dist) を読むので、公開する形はそちらで確かめる。
 * conditions を指定すると既定は足されないので、Vitest が Node 環境で使う条件を並べる。
 * 各パッケージの vitest.config.ts で `...readPlatformSource` として使う (lumorphia/editor と同じ)
 */
export const readPlatformSource = {
  ssr: { resolve: { conditions: ["source", "node", "development|production"] } },
};
