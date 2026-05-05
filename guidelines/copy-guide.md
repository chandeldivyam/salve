# Copy Guide

The voice of salve. Read once, refer back when writing UI strings.

Inspired by Shopify Polaris's [empty state](https://polaris-react.shopify.com/components/layout-and-structure/empty-state)
and content guidelines, Linear Method's clarity principles, and
zbugs's lean inline-string approach.

---

## 1. Voice

- **Direct.** Tell the user what is and what to do. No filler.
- **Calm.** Never alarmist. Errors are stated, not panicked about.
- **Specific.** "Customer email or name" beats "Search". "12 tickets" beats
  "Several tickets".
- **Sentence case.** Always — for headings, buttons, and labels.
- **No jargon.** If a normal person wouldn't say it at the dinner table,
  rephrase. Linear's principle: don't invent terms; call things what they
  are.
- **No "please".** It's filler in product UI. "Save" not "Please save".

---

## 2. Empty states

Pattern (Polaris-derived):

> **Headline** = current state OR action-oriented prompt.
> **Body** = one sentence explaining what will happen / what to do.
> **Primary action** = `{strong verb} {noun}` — e.g. "Add tag", "Create domain".

Rules:

- Headline ≤ 6 words.
- Body ≤ 15 words.
- One primary action max. Secondary actions ("Learn more") are okay.
- No "yet" unless the empty state is genuinely temporal (something *will*
  appear soon, e.g. "Replies will appear here"). "No tags yet" reads as
  filler — prefer "No tags".
- Never make the user feel behind ("You haven't done X" → "Add your first X").

### Examples (rewrite of current salve strings)

| Page | Before | After |
|------|--------|-------|
| Inbox | "Your inbox is empty" + "Replies will appear here." | ✅ Keep — temporal "will" is meaningful here. |
| Customers | "No customers match this view yet." | "No customers match this view." (drop "yet" — view-bound, not temporal) |
| Tags | "No tags yet" + "Group tickets so agents can filter…" | "No tags" + "Tag tickets so agents can filter the inbox." |
| Custom fields | "No fields yet" + "Define operational…" | "No custom fields" + "Capture operational data on every ticket." |
| Email domains | "Add a domain first" | "Add a sending domain" + "You'll need a verified domain to send replies." |

---

## 3. Buttons

- **Pattern:** `{verb} {noun}` — except: Save, Close, Cancel, OK, Done,
  Send, Reply.
- Pick **Add** OR **New** consistently — we use **Add** for atomic items
  (Add tag, Add domain, Add address) and **New** for compound creation
  flows (New ticket, New conversation). Stick with this.
- No articles in button labels: "Add domain" not "Add a domain".
- No trailing ellipsis unless the button opens a dialog requiring more
  input (e.g. "Move to…" for picker dialogs is acceptable).

### Common verbs

| Use | Don't use |
|-----|-----------|
| Add | Create (for atomic items) |
| New | Add (for compound flows) |
| Save | Submit, Confirm |
| Send | Submit, Post |
| Reply | Respond |
| Delete | Remove (use Remove only when item still exists, just disassociated) |
| Archive | Hide |
| Resolve | Close (we use Resolve for ticket lifecycle, Close for dialogs) |

### Destructive actions

- Always read like a verdict: "Delete tag", "Archive domain". Never
  "Are you sure you want to delete this tag?" — the modal title states the
  action, the body explains the consequence:

  > **Delete tag**
  > 12 tickets currently use this tag. They'll keep their assignments but
  > the tag won't appear in the picker.
  >
  > [Cancel] [Delete tag]

---

## 4. Errors

- **Never blame the user.** "We couldn't save this draft" not "You didn't
  fill in the title".
- **State the problem, then the fix.** "Couldn't connect to Gmail.
  Reconnect from Settings → Channels."
- No exclamation marks.
- Never expose stack traces or error codes in user-facing copy. Codes
  belong in error logs, not toasts.

### Toast patterns

- Success: past tense, short. "Tag created.", "Reply sent.", "Draft
  saved."
- Error: present tense, action-oriented. "Couldn't send reply. Try
  again." (with retry CTA)
- Info: present tense. "Reconnecting to Gmail…"

---

## 5. Pagination & "load more"

Pick the affordance based on the shape:

- **Tabular lists with column headers** (customers, audit log, etc.) →
  use a "Show more" button at the bottom of the page. Predictable, lets
  the user see total fetched count.
- **Dense feeds** (inbox, timeline) → infinite scroll. The user is
  reading sequentially.

Label: **"Show more"** (not "Load more", "Next page", "More"). Page count
shown next to it: "Show more (showing 50 of 50+)".

---

## 6. Form fields

- **Labels:** sentence case, no colon. Field is the punctuation.
- **Helper text:** below the field, ≤ 12 words, only when non-obvious.
  No helper text for "Email" — the label is the documentation.
- **Placeholders:** show *example* values, not instructions. "Acme
  Co." not "Enter your company name". Never use placeholders as labels.
- **Required:** mark with a subtle "Required" hint, not asterisks. We
  prefer to mark *optional* fields instead — that's the smaller set.
- **Validation messages:** appear inline beneath the field. State the
  problem, not the field name. "Must include @" beats "Email is invalid".

---

## 7. Time and numbers

- Relative time for ≤ 7 days: "2h", "1d", "3d ago" (we use
  `formatDistanceToNowStrict` from date-fns).
- Absolute date for > 7 days: "Apr 12", "Apr 12, 2025" if not current
  year.
- Tabular numbers (CSS `tabular-nums`) anywhere counts or times appear in
  a list — keeps columns aligned.
- Counts: "3 tags", "1 ticket" (singular/plural), "0 tickets" (zero is
  plural in English).
- For very large counts, use `+` to indicate approximation: "50+
  tickets" (rather than fetching exact total).

---

## 8. Empty list (within a populated page)

When a *section* is empty but the page is not (e.g. "No tags assigned"
inside a populated customer profile):

- **One line, neutral.** "No tags." or "—".
- No CTA — that belongs in the parent action menu, not inline.
- No icon.

---

## 9. Settings

- Section descriptions: one sentence explaining the feature in user
  terms. No marketing language, no exclamation marks.
- Toggle labels: state the *feature*, not the toggle position.
  "Email notifications" + "Send a daily digest of unresolved tickets."
  Not "Enable daily digest emails".
- Group descriptions: explain who owns what setting.
  "These apply to your workspace. Per-channel overrides are below."

---

## 10. The hard rule

Before shipping any new string, read it back to yourself and ask:

> *Would I write this in a Slack message to a teammate?*

If you'd shorten or simplify it in chat, shorten or simplify it in the UI
too.
