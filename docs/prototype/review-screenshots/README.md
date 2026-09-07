# Prototype review screenshots

Captured by `node scripts/prototype-review-screenshots.mjs --base http://localhost:<port>`
against a running development server. Regenerate rather than edit.

**Real product surfaces only.** The specimen pages this set used to draw on
(`/prototype/exits`, `/prototype/context`) have been removed: they were review
scaffolding with explanatory prose around each control, and a design review that
judges scaffolding is not judging the product. Every frame below is a state of a
screen a trader would actually be looking at, reached through a query parameter
where the state needs one (`?filled=1`, `?exits=1`, `?edit=<id>`) or through a
scripted interaction where it needs a click.

Dark is the product's default and therefore the primary theme. A light companion
is captured only where theme behaviour materially differs.

| #     | File                         | What it shows                                                                     |
| ----- | ---------------------------- | --------------------------------------------------------------------------------- |
| 1–2   | `01-choice-*`, `02-choice-*` | "Is the trade still open?" — Still open / Fully closed, desktop and phone         |
| 3–8   | `03-…` – `08-…`              | Still open: default, target added, plan editor, feelings editor, answered prompts |
| 9–14  | `09-…` – `14-…`              | Fully closed: default, plan / feelings / review editors, answered prompts         |
| 15–17 | `15-…` – `17-…`              | The timestamp control: desktop popover, phone sheet, month/year selection         |
| 18–21 | `18-…` – `21-…`              | Partial exits: collapsed legs, the active editor, closed vs still-open status     |
| 22–25 | `22-…` – `25-…`              | Trades: desktop, phone, 320px, a partial trade, incomplete monetary coverage      |
| 26–31 | `26-…` – `31-…`              | Trade details: Overview, Entry & exits, Review — desktop and phone                |
