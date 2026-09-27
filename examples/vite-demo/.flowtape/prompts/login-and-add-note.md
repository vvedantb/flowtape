# Flow: Login and add note

> Recorded with flowtape on 27 September 2026. 10 events. Source: `.flowtape/flows/login-and-add-note.json`.

## Goal

Replay the recorded journey "Login and add note" in a real browser and confirm each step works as recorded. It covers 2 page(s) and 2 form submission(s). Then explore around it using the fuzz hints and report what breaks.

## Preconditions

- App running at `http://localhost:5180`. Start the dev server first if it is not running.
- Start from `/`.
- A browser automation tool is available (for example Playwright MCP).
- Viewport about 1280×720, as recorded.
- Redacted fields read their values from environment variables: `FLOWTAPE_PASSWORD`, `FLOWTAPE_MEMBER_ID`. Use test credentials only.
- Seed / known state: TODO: describe the accounts and data the app needs before step 1.

## Steps

1. Open `/`.
2. Type `ada@example.test` into the field "Email" (`[data-testid="login-email"]`).
3. Fill the password field "Password" (`[data-testid="login-password"]`) with the value from `$FLOWTAPE_PASSWORD` (15 characters when recorded). **Redacted:** the recorded value was not stored. Never print or log it.
4. Fill the text field "Member ID" (`[data-testid="login-member-id"]`) with the value from `$FLOWTAPE_MEMBER_ID` (11 characters when recorded). **Redacted:** the recorded value was not stored. Never print or log it.
5. Click the button "Sign in" (`[data-testid="login-submit"]`).
6. The click in step 5 submits the form `[data-testid="login-form"]` (POST). Do not submit it again.
7. Wait for the app to move to `/notes`.
8. Type `Water the plants` into the field "New note" (`[data-testid="note-input"]`).
9. Click the button "Add note" (`[data-testid="note-add"]`).
10. The click in step 9 submits the form `[data-testid="note-form"]` (GET). Do not submit it again.

## Assertions

- After step 6, the URL path is `/notes` and the new page renders without an error screen.
- After step 6 (submit), the form shows a success state or clear validation messages. It does not fail silently.
- After step 10 (submit), the form shows a success state or clear validation messages. It does not fail silently.
- After step 10, the text typed in step 8 appears on the page (for example as a new list item). TODO: confirm the exact outcome.
- No uncaught console errors and no failed (4xx/5xx) network requests during the flow.
- TODO: add product-specific checks for the final state.

## Fuzz hints

- "Email" (`[data-testid="login-email"]`): try empty, `a@`, `@b.co`, `a b@c.co` and a 300-character address.
- "Password" (`[data-testid="login-password"]`): try an empty value and an obviously fake wrong value such as `wrong-value-123`. Never use real credentials.
- "Member ID" (`[data-testid="login-member-id"]`): try an empty value and an obviously fake wrong value such as `wrong-value-123`. Never use real credentials.
- "New note" (`[data-testid="note-input"]`): try empty, whitespace only, 1,000+ characters, emoji and right-to-left text, and markup such as `<b>x</b>`.
- Submit `[data-testid="login-form"]` with all fields empty, then with one required field missing at a time. Double-submit quickly.
- Submit `[data-testid="note-form"]` with all fields empty, then with one required field missing at a time. Double-submit quickly.
- Try controls next to the recorded ones that the recording did not use, and double-click the recorded buttons.
- Reload the page and use browser Back/Forward on `/`, `/notes` mid-flow.

## Out of bounds

- Stay on `http://localhost:5180`. Do not follow links to other origins.
- Use synthetic test data only. Do not enter real personal data.
- Secrets / credentials must never be logged, echoed, screenshotted or written to files. Refer to them by variable name only.
- Do not try to recover redacted values from storage, network traffic or the flow file.
- Do not change application code, databases or files under `.flowtape/` while exploring. Report findings instead.
- Do not take destructive or irreversible actions (deleting data, payments, emails to real people) unless the recorded steps do.

## Report back

- For each step: pass or fail, with what you saw.
- For each problem: exact steps to reproduce, expected result, actual result and any console or network errors.
