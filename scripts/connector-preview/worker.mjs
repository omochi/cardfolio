import { WorkerEntrypoint } from "cloudflare:workers";
import binding from "virtual:sites-connector-preview";

// ローカル専用の RPC 接続先。Site のエントリーポイントがリクエスト単位に制限し、
// Node アダプターが各呼び出しを所有エージェントに中継する。
export class ConnectorPreview extends WorkerEntrypoint {
  async getContext() {
    return binding.getContext?.() ?? { status: "binding_unavailable" };
  }

  async invoke(connectorId, actionName, args) {
    return binding.invoke(connectorId, actionName, args);
  }
}
const worker = { fetch() { return new Response("Not found", { status: 404 }); } };

export default worker;
