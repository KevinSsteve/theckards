import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button, refuseWhileBusy } from "./Button";

const render = (props: Parameters<typeof Button>[0]) => renderToStaticMarkup(createElement(Button, props, "Sign"));

describe("a busy button keeps focus", () => {
  // A disabled element cannot hold focus. The whole point is that a busy button is never `disabled`.
  it("announces busy without becoming disabled", () => {
    const html = render({ busy: true });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/\sdisabled=""/);
  });

  it("is an ordinary button when idle", () => {
    const html = render({ busy: false });
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("aria-busy");
  });

  it("still disables properly when the form is incomplete", () => {
    expect(render({ disabled: true })).toMatch(/\sdisabled=""/);
  });
});

describe("a busy button refuses activation", () => {
  const event = () => ({ preventDefault: vi.fn() }) as unknown as Parameters<ReturnType<typeof refuseWhileBusy>>[0];

  // Implicit submission (Enter in a field) fires a click on the default button, so cancelling the click is what
  // stops a busy form from being submitted twice.
  it("cancels the click, and with it any form submission, while busy", () => {
    const onClick = vi.fn();
    const click = event();
    refuseWhileBusy(true, onClick)(click);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes the click through when idle", () => {
    const onClick = vi.fn();
    const click = event();
    refuseWhileBusy(false, onClick)(click);
    expect(onClick).toHaveBeenCalledWith(click);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it("lets a plain submit button submit when idle", () => {
    const click = event();
    expect(() => refuseWhileBusy(false)(click)).not.toThrow();
    expect(click.preventDefault).not.toHaveBeenCalled();
  });
});
