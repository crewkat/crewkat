export type AuthEmailDelivery = "sent" | "fallback" | "failed";

/**
 * Converts the server-only delivery result into the public action response.
 * A one-time code may cross the client boundary only when no provider key is
 * configured and the in-app development fallback is intentionally active.
 */
export function authCodeClientResult(code: string, delivery: AuthEmailDelivery) {
  return {
    emailDelivery: delivery,
    displayCode: delivery === "fallback" ? code : null,
  };
}
