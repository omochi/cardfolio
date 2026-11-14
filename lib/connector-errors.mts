import { z } from "zod/v4";

/** Validate and project runtime results onto the public connector response. */
export function connectorResponse(result: unknown): Response {
  try {
    // クライアント側の復旧 UI から除去できるよう、サーバー専用の解析は遅延する。
    const requestId = z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .optional()
      .catch(undefined);
    const envelope = {
      error: z.never().optional(),
      content: z.never().optional(),
      structuredContent: z.never().optional(),
      isError: z.never().optional(),
      requestId,
    };
    const content = z.object({
      content: z.array(z.object({ type: z.string() }).catchall(z.json())),
      structuredContent: z.json().optional(),
      isError: z.never().optional(),
      error: z.never().optional(),
    });
    const failure = z.object({
      ...envelope,
      status: z
        .string()
        .min(1)
        .refine((value) => value !== "success"),
      message: z.string().min(1),
      retryAfterMs: z.number().int().nonnegative().safe().optional(),
      result: content.optional(),
    });
    const success = z.object({
      ...envelope,
      status: z.literal("success"),
      result: content,
      message: z.never().optional(),
      retryAfterMs: z.never().optional(),
    });
    const schema =
      result !== null &&
      typeof result === "object" &&
      "status" in result &&
      result.status === "success"
        ? success
        : failure;
    const parsed = schema.safeParse(result);
    if (parsed.success) {
      // バインディングの契約どおり、JSON の状態から結果を判定する。
      return Response.json(parsed.data, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
  } catch {
    // 循環参照などでシリアライズできない実行時の値も未確定とする。
  }
  return Response.json(
    {
      status: "upstream_error",
      message:
        "The app did not return a confirmed result. The action may have completed; check before trying again.",
    },
    { status: 502, headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Presentation only. The caller supplies the starter's server-generated SIWC URL. */
export function connectorErrorRecovery(
  error: { status: string; message: string },
  connectorName: string,
  reconnectHref: string,
): { message: string; action?: { label: string; href: string } } {
  if (error.status === "reauthentication_required") {
    return {
      message: error.message,
      action: { label: `Connect ${connectorName}`, href: reconnectHref },
    };
  }
  // その他の結果は、同意の欠如や再実行の安全性を証明しない。
  return { message: error.message };
}
