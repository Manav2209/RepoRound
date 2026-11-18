export interface WorkerTurn {
  id: string;
  controller: AbortController;
}

/** STT can amend one SDK message across multiple finalized speech fragments. */
export class FinalizedTurnIds {
  private readonly ids = new Map<
    string,
    { revision: number; operationId: string }
  >();
  commit(messageId: string) {
    const revision = (this.ids.get(messageId)?.revision ?? -1) + 1;
    const operationId = revision ? `${messageId}_r${revision}` : messageId;
    this.ids.set(messageId, { revision, operationId });
    if (this.ids.size > 128) this.ids.delete(this.ids.keys().next().value!);
    return operationId;
  }
  resolve(messageId: string) {
    return this.ids.get(messageId)?.operationId ?? messageId;
  }
}

/** A generated question becomes current only when its speech starts. */
export class TurnLifecycle {
  private active?: WorkerTurn;
  private staged?: { turnId: string; questionId: string };
  constructor(private readonly onCancel: (turnId: string) => void) {}
  get hasWork() {
    return !!(this.active || this.staged);
  }
  get stagedTurnId() {
    return this.staged?.turnId;
  }
  begin(id: string) {
    this.cancel();
    const turn = { id, controller: new AbortController() };
    this.active = turn;
    return turn;
  }
  stage(turn: WorkerTurn, questionId: string) {
    turn.controller.signal.throwIfAborted();
    if (this.active !== turn)
      throw new DOMException("Turn superseded", "AbortError");
    this.staged = { turnId: turn.id, questionId };
  }
  finish(turn: WorkerTurn) {
    if (this.active === turn) this.active = undefined;
  }
  speechStarted() {
    const questionId = this.staged?.questionId;
    this.staged = undefined;
    return questionId;
  }
  cancel() {
    const ids = new Set<string>();
    if (this.active) {
      ids.add(this.active.id);
      this.active.controller.abort(
        new DOMException("User resumed speaking", "AbortError"),
      );
    }
    if (this.staged) ids.add(this.staged.turnId);
    this.active = undefined;
    this.staged = undefined;
    for (const id of ids) this.onCancel(id);
  }
}
