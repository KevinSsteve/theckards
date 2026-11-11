import { describe, expect, it } from "vitest";
import { SESSION_ENDED_EVENT, createSessionWatch } from "./session-watch";

const reply = (status: number) => new Response(null, { status });

describe("noticing that the session ended", () => {
  it("lets ordinary responses through, including other failures", () => {
    const watch = createSessionWatch(new EventTarget());
    for (const status of [200, 204, 400, 403, 404, 409, 429, 500, 503]) expect(watch.check(reply(status))).toBe(true);
    expect(watch.ended()).toBe(false);
  });

  it("treats a 401 as the end of the session", () => {
    const watch = createSessionWatch(new EventTarget());
    expect(watch.check(reply(401))).toBe(false);
    expect(watch.ended()).toBe(true);
  });

  // Several panels poll at once, so many 401s can arrive together. The person should be told once.
  it("announces it once, however many requests fail", () => {
    const target = new EventTarget();
    let announced = 0;
    target.addEventListener(SESSION_ENDED_EVENT, () => { announced += 1; });
    const watch = createSessionWatch(target);
    for (let i = 0; i < 13; i += 1) watch.check(reply(401));
    expect(announced).toBe(1);
  });

  it("stays ended after a later success, so polling does not resume against a dead session", () => {
    const watch = createSessionWatch(new EventTarget());
    watch.check(reply(401));
    watch.check(reply(200));
    expect(watch.ended()).toBe(true);
  });
});
