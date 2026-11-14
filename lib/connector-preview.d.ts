declare module "virtual:sites-connector-preview" {
  const binding: import("./connector-contract.mjs").ConnectorBinding;
  export default binding;
}

// 環境バインディングを使うのはローカルプレビューだけ。ホストされた Sites は、
// sites-worker.ts の ctx.props.CONNECTORS を通じてリクエスト単位の機能を受け取る。
declare namespace Cloudflare {
  interface Env {
    CONNECTORS?: import("./connector-contract.mjs").ConnectorBinding;
  }
}
