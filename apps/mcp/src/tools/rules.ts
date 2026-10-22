/** The answer rules every tool description opens with, in two lines. The server's `instructions` carry all six. */
export const ANSWER_RULES =
  "Figures are decimal strings Maester read from the investor's filings; copy them as given and never add, divide, compare, round or convert them.\n" +
  "Unknown is null with its reason in words, never zero.";

/** A description: the rules, what the tool does, and what to do when it has no answer. */
export const describeTool = (does: string, whenNoAnswer: string) => `${ANSWER_RULES}\n${does}\n${whenNoAnswer}`;
