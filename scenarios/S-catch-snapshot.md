# S-catch-snapshot — a `catch` read in a `fn` called from a handler is a snapshot: the committed value while a question is out

Rules exercised: R-8, R-f-4, R-f-7, AC-4.

## Program

```rx
export default component App() {
  source ans = await fetch("a") -> 0
  fn cur() => ans catch (e) => -1
  source seen := 0
  action reload() { try { await fetch("save"); refresh ans } catch (e) {} }
  action note(d: number) { seen := cur() + d }
  <p>{ans catch (e) => "err"} seen {seen}</p>
}
```

`cur` is written once and read from two scopes. Called from an action (or
any handler) it is imperative scope, where every read is a snapshot (R-8): an equation with a
new question out reads its committed value, and a matching failure is the
`catch`'s alternative (R-f-4, R-f-7). Instant 4: the action's `refresh` is
out, and `note`'s `cur()` reads `2`, what the screen shows. Instant 6:
the answer failed, so the snapshot takes the `catch` and reads `-1`.

Found by the eval board (r15prep, `catch-read-in-handler-during-refresh.rx`):
the compiled `catch` built a fresh error boundary at each read, which in a
handler had no committed value while the refresh was out, so the click
threw `NotReadyError` and was lost.

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0 | mount | `0 seen 0` |
| 1 | resolve "a" 2 | `2 seen 0` |
| 2 | handler `note(0)` | `2 seen 2` |
| 3 | handler `reload()` | `2 seen 2` |
| 4 | resolve "save" 0 | `2 seen 2` |
| 5 | handler `note(1)` | `2 seen 3` |
| 6 | reject ans "down" | `err seen 3` |
| 7 | handler `note(0)` | `err seen -1` |
