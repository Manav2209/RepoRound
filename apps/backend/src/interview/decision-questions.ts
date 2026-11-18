/** Structural guards; semantic relevance is reviewed against the supplied evidence. */
export function usableDecisionQuestion(text: string): boolean {
  const question = text.trim();
  return (
    question.length >= 12 &&
    question.length <= 320 &&
    question.split(/\s+/).length <= 35 &&
    (question.match(/\?/g) ?? []).length === 1 &&
    question.endsWith("?") &&
    !/\b(?:essential|necessitated|necessitates)\b/i.test(question) &&
    !/\b[\w./-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|php)\b/i.test(question) &&
    !/what (?:does|is) (?:this|your|the) project|what (?:part|component)s? (?:did you|do you) own|what responsibility does|what breaks first under load|walk me through (?:one|the) request/i.test(
      question,
    ) &&
    !/^(?:what is|define) (?:redis|kafka|docker|react|typescript|kubernetes)\??$/i.test(
      question,
    ) &&
    !/^why (?:did you )?(?:use|choose|pick) [\w.+-]+\??$/i.test(question)
  );
}
