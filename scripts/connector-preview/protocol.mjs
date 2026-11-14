import { z } from "zod";

const name = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\s/\x00-\x1f\x7f]+$/u);
const fields = { connectorId: name, actionName: name };

// 余分な呼び出しフィールドを拒否する。アカウント選択とネイティブツール名は、
// 生成された Site のリクエストではなく、所有エージェントが決定する。
export const invocationSchema = z
  .object({ ...fields, arguments: z.record(z.unknown()) })
  .strict();
export const grantSchema = z
  .object({ ...fields, readOnly: z.literal(true) })
  .strict();
export const grantsSchema = z.array(grantSchema);

// これらの制限は所有エージェントだけが設定する。それ以外の場合、セッションは
// 所有者が閉じるまで続く。Node のタイマーには符号付き 32 ビットのミリ秒値が必要。
const duration = z
  .number()
  .int()
  .positive()
  .max(2 ** 31 - 1);
export const sessionOptionsSchema = z
  .object({
    timeoutMs: duration.default(120000),
    maxConcurrent: z.number().int().positive().safe().default(64),
    lifetimeMs: duration.optional(),
    maxCalls: z.number().int().positive().safe().optional(),
  })
  .strict();

// パイプでは JSON-RPC の応答と停止通知を送る。プロバイダーの失敗も
// MCP の結果として result 内に入り、JSON-RPC エラーはドライバーの失敗を示す。
export const driverMessageSchema = z.union([
  z.object({ jsonrpc: z.literal("2.0"), method: z.literal("stop") }).strict(),
  z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.string().uuid(),
      result: z.record(z.unknown()),
    })
    .strict(),
  z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.string().uuid(),
      error: z
        .object({
          code: z.number().int(),
          message: z.string(),
          data: z.unknown().optional(),
        })
        .strict(),
    })
    .strict(),
]);
