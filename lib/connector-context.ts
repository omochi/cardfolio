import { AsyncLocalStorage } from "node:async_hooks";
import type { ConnectorBinding } from "./connector-contract.mjs";

// Vinext が再検証コンテキストを生成する前に、信頼できる機能を取得する。
// 再検証コンテキストは独自の実行コンテキストを保持しない。リクエスト間で共有しない。
const bindings = new AsyncLocalStorage<ConnectorBinding | undefined>();

export function runWithConnectorBinding<T>(
  binding: ConnectorBinding | undefined,
  run: () => T,
): T {
  return bindings.run(binding, run);
}

export function getConnectorBinding(): ConnectorBinding | undefined {
  return bindings.getStore();
}
