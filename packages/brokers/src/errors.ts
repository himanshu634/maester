/**
 * - BROKER_UNAVAILABLE: the broker could not be reached or answered with an error of its own.
 * - BROKER_SIGNED_OUT: the broker no longer accepts the session (one of `signedOutStatuses`).
 * - BROKER_REFUSED: the broker turned down the sign-in or the saved key.
 * - BROKER_ANSWER_UNREADABLE: the answer is not the shape the plugin expects.
 */
export type BrokerErrorCode = "BROKER_UNAVAILABLE" | "BROKER_SIGNED_OUT" | "BROKER_REFUSED" | "BROKER_ANSWER_UNREADABLE";

/** Its message never carries a URL, a credential, a token or the broker's own error text. */
export class BrokerError extends Error {
  constructor(readonly code: BrokerErrorCode, message: string) {
    super(message);
  }
}
