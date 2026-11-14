import { Readable } from "node:stream";
import { setMaxListeners } from "node:events";
import getRawBody from "raw-body";
import { z } from "zod/v4";
import {
  grantSchema,
  invocationSchema,
  sessionOptionsSchema,
} from "./protocol.mjs";

// エージェントが Site をローカルで構築・テストする間、コネクター呼び出しを確認する。
// エージェントが Site に許可する読み取り操作を選択した後、
// connector-preview-session.mjs がこのヘルパーを使う。各リクエストについて選択内容と
// セッションの制限を確認してから、実際のツール呼び出しをエージェントに依頼する。
// タイムアウト、終了処理、Site に返す結果フィールドも扱う。
// これはエージェントの一時セッションで実行し、デプロイ済み Site では実行しない。
const messages = {
  invalid_request: "This app request is invalid or too large.",
  binding_unavailable:
    "Connected apps need an active agent preview session in this preview.",
  tool_not_allowed: "This preview cannot use the requested app action.",
  rate_limited:
    "A request limit was reached while using this connector. Please wait before trying again.",
  tool_error: "An error was reported while running this connector action.",
  upstream_error:
    "The app did not return a confirmed result. The action may have completed; check before trying again.",
};
const failure = (status) => ({ status, message: messages[status] });
const reply = (result) =>
  Response.json(result, { headers: { "Cache-Control": "no-store" } });
const requestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/)
  .optional()
  .catch(undefined);
const resultSchema = z.object({
  error: z.never().optional(),
  status: z.never().optional(),
  content: z.array(z.object({ type: z.string() }).catchall(z.json())),
  structuredContent: z.json().optional(),
  isError: z.boolean().optional(),
  requestId: requestIdSchema,
});

export function createPreviewBinding({ tools, ...options }) {
  const { lifetimeMs, timeoutMs, maxCalls, maxConcurrent } =
    sessionOptionsSchema.parse(options);
  const grants = new Map();
  for (const tool of tools) {
    const { invoke, ...grant } = tool;
    if (!grantSchema.safeParse(grant).success || typeof invoke !== "function")
      throw new Error(
        "Preview tools must be authenticated, resolved read actions.",
      );
    const key = JSON.stringify([tool.connectorId, tool.actionName]);
    if (grants.has(key))
      throw new Error(
        "Ambiguous connector action; the host must resolve its connection first.",
      );
    grants.set(key, tool.invoke);
  }
  const expiresAt =
    lifetimeMs === undefined ? Infinity : Date.now() + lifetimeMs;
  const ended = new AbortController();
  setMaxListeners(maxConcurrent, ended.signal);
  const expiry =
    lifetimeMs === undefined
      ? undefined
      : setTimeout(() => ended.abort(), lifetimeMs);
  expiry?.unref();
  let remaining = maxCalls ?? Infinity;
  let active = 0;

  return {
    close() {
      clearTimeout(expiry);
      ended.abort();
    },
    async fetch(request) {
      if (ended.signal.aborted || Date.now() >= expiresAt)
        return reply(failure("binding_unavailable"));
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/invoke"
      )
        return reply(failure("invalid_request"));
      let call;
      try {
        const body = await readBounded(request, 65536);
        call = invocationSchema.parse(JSON.parse(body));
      } catch {
        return reply(failure("invalid_request"));
      }
      // リクエストの読み込み後に再確認する。転送中に終了する場合があるため。
      if (ended.signal.aborted || Date.now() >= expiresAt)
        return reply(failure("binding_unavailable"));
      const invoke = grants.get(
        JSON.stringify([call.connectorId, call.actionName]),
      );
      if (!invoke || remaining === 0) return reply(failure("tool_not_allowed"));
      if (active >= maxConcurrent) return reply(failure("rate_limited"));
      active++;
      remaining--;
      let deadline;
      let onEnd;
      try {
        const result = await Promise.race([
          // タイムアウトは待機を終えるだけで、プロバイダーの呼び出しは終了しない。
          // 完了まで同時実行数に含めるが、他の枠は妨げない。
          Promise.resolve()
            .then(() => invoke(call.arguments))
            .then(publicResult)
            .finally(() => {
              active--;
            }),
          new Promise((resolve) => {
            deadline = setTimeout(
              () => resolve(failure("upstream_error")),
              timeoutMs,
            );
          }),
          new Promise((resolve) => {
            onEnd = () => resolve(failure("upstream_error"));
            ended.signal.addEventListener("abort", onEnd, { once: true });
          }),
        ]);
        if (ended.signal.aborted || Date.now() >= expiresAt)
          return reply(failure("upstream_error"));
        if (
          new TextEncoder().encode(JSON.stringify(result)).byteLength >
          8 * 1024 * 1024
        )
          return reply(failure("upstream_error"));
        return reply(result);
      } catch {
        return reply(failure("upstream_error"));
      } finally {
        clearTimeout(deadline);
        ended.signal.removeEventListener("abort", onEnd);
      }
    },
  };
}

export async function readBounded(request, limit) {
  if (!request.body) throw new Error("Missing body");
  const stream = Readable.fromWeb(request.body);
  try {
    // バイト数の制限とストリームエラーは raw-body が扱う。厳密なデコードにより、
    // 不正な UTF-8 を拒否し、呼び出し元の引数を黙って変更しない。
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await getRawBody(stream, { limit }),
    );
  } finally {
    stream.destroy();
  }
}

function publicResult(result) {
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) return failure("upstream_error");
  result = parsed.data;
  // ネイティブツールは MCP 結果を返す。プレビューホストとの境界で一度だけ変換する。
  // プロバイダーが作成したトップレベルの状態や転送メタデータを受け入れない。
  const payload = {
    content: result.content,
    // ホストされたバインディングと同様に、null を含むすべての JSON 値を保持する。
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
  };
  const requestId =
    result.requestId === undefined ? {} : { requestId: result.requestId };
  if (result.isError === true) {
    const detail = result.structuredContent;
    if (detail?.error_code === "RATE_LIMITED") {
      const retryAfterMs =
        readRetryAfterMs(detail.retry_after_seconds) ??
        readRetryAfterMs(detail.retry_after);
      return {
        ...failure("rate_limited"),
        ...requestId,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }
    const invalidArguments =
      detail?.error_code === "INVALID_ARGUMENT" &&
      detail.error_data?.type === "invalid_action_arguments" &&
      detail.error_data?.failure_stage === "argument_binding";
    return {
      ...failure(invalidArguments ? "invalid_request" : "tool_error"),
      result: payload,
      ...requestId,
    };
  }
  return { status: "success", result: payload, ...requestId };
}

function readRetryAfterMs(value) {
  let milliseconds;
  if (
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value.trim()))
  ) {
    milliseconds = Number(value) * 1000;
  } else if (
    typeof value === "string" &&
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value.trim(),
    )
  ) {
    milliseconds = Math.max(0, Date.parse(value) - Date.now());
  }
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : undefined;
}
