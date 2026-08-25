export type GrsaiErrorCode = "auth" | "balance" | "moderation" | "invalid_request" | "upstream" | "timeout";

export class GrsaiError extends Error {
  constructor(
    public code: GrsaiErrorCode,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
