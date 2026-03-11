/**
 * Encodes arbitrary state payload into a compact string for `users.botState`.
 *
 * The format is backward-compatible because old states remain plain strings,
 * while new states use the `json:` prefix and can safely coexist.
 *
 * @param key State machine key.
 * @param payload Additional payload for the state.
 * @returns Encoded bot state string.
 */
export function encodeBotState(
  key: string,
  payload: Record<string, unknown> = {},
): string {
  return `${key}:json:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

/**
 * Decodes a bot state created with {@link encodeBotState}.
 *
 * @param state Raw value stored in `users.botState`.
 * @returns Decoded key and payload, or `null` when the state is legacy/plain.
 */
export function decodeBotState(state: string | null | undefined): {
  key: string;
  payload: Record<string, unknown>;
} | null {
  if (!state) return null;
  const marker = ":json:";
  const markerIndex = state.indexOf(marker);
  if (markerIndex === -1) return null;

  const key = state.slice(0, markerIndex);
  const encoded = state.slice(markerIndex + marker.length);

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return { key, payload };
  } catch {
    return null;
  }
}
