# Costo de WhatsApp (Zendesk app)

Private Zendesk Support app by Zenital that estimates what Meta charges for WhatsApp messages sent from Zendesk: cost per ticket, estimated monthly cost, and the cost of the ticket an agent has open.

- **Version:** 1.0.0 (`manifest.json`)
- **Owner:** Agustín Mori, Zenital (agustin.mori@zenital.co)
- **UI language:** Spanish, English and Brazilian Portuguese (see [Languages](#languages)). App texts in `translations/en.json`, `es.json`, `pt-br.json`.
- **Status:** unit-tested, and the data sources were checked by hand on a Zenital test account (93 WhatsApp tickets; see [Verified on a Zenital test account](#verified-on-a-zenital-test-account)). The end-to-end numbers of a full dashboard run have not yet been compared with Meta billing.

---

## Features

### Dashboard (left navigation, `nav_bar`)

Admin-only (it uses the Incremental Export API).

| Area | What it shows |
|---|---|
| Period picker | 7, 30, 90 days (rolling, ending now) or a custom date range (`Desde` 00:00 to `Hasta` 24:00, both days included, local time; an end in the future is cut at now). Picking a period changes nothing until "Ver costo" runs the calculation; "Cancelar" stops it (partial results are flagged). Invalid dates (empty, `Desde` in the future, `Desde` after `Hasta`) show a message. |
| Time estimate and sample | Before a full calculation the app counts the WhatsApp tickets (one Search count request). When reading them all would take 5 minutes or more, it says how long and offers a random sample instead, with a slider for its size (default 500 tickets, about 5 minutes). See [Sample estimates](#sample-estimates). |
| Progress card | A two-segment bar for the two steps: "1. Buscar tickets" (ticket export, 0–40%) and "2. Leer conversaciones" (one conversation log per WhatsApp ticket, 40–99%). Each step shows live counts (tickets found and reviewed; tickets read and messages), the active step pulses and finished steps get a check. The overall percentage and an estimate of the time left (from the pace of the conversation logs read so far) sit on the right. |
| Last result cache | The last complete calculation is stored in the browser and shown instantly on open, with "Datos calculados el dd/mm a las hh:mm". |
| Saved data window | Every result remembers the time it holds messages for (`window`), which can be wider than the period shown. "Ver costo" picks the cheapest way (`planRun` in `counter.js`): **cached**: the period is inside the window (e.g. a past custom range, or 30 days after a 90-day run): no API calls at all ("Este período ya estaba en el último cálculo"); **update**: read only the tickets changed since the window ended, keeping up to 180 days of earlier history so a longer period stays available; **extend**: the period starts earlier than the window (e.g. 30 → 90 days): read the earlier time and skip the conversation logs of tickets the window already holds in full (created inside it and not changed since; the progress card shows "N ya guardados"); **full**: no usable result (none, other channels, no overlap). A cancelled or failed run is never reused. |
| Partial results | While conversation logs load, the dashboard re-renders with "Resultados parciales" every 30 tickets, at most once every 3 seconds. Tickets updated inside the chosen period are read first: once they are done the period's numbers are final ("El período elegido ya está completo…") and only the comparisons (deltas, "vs. anterior", Meta invoices) wait for the previous period. |
| Update runs | When the cached result covers the start of the new range (both periods) with the same channel settings, "Ver costo" reads only tickets updated since the last run, re-reads their whole conversation logs (from the start of the previous period, not only the new time) and replaces their old messages ("Actualizando desde el último cálculo…"). The numbers are the same as a full run (checked by a test). Otherwise it reads both periods from scratch. |
| Header | Zenital logo, title, period picker and buttons. Sticky on desktop. |
| Headline | One short line: WhatsApp tickets in the period, cost per ticket, cost per month. |
| KPI tiles | **Costo por ticket** (average and median; blue gradient hero tile), **Costo por mes** (after the free tier; when the free messages cover everything it reads US$ 0,00 and says what it would cost without them, also in the headline), **Tickets de WhatsApp** (and messages sent per ticket). Each has a delta vs. the previous period of the same length (orange = cost went up, green = went down). |
| Stats row | **Mensajes enviados** (total, and how many are sent per customer message; customer messages are free), **Respondido por bots** (share of sent messages from bots or AI agents; they are charged too), **País detectado** (share of tickets whose customer country is known; low means the default country matters; shown only once a run finishes, since profile phones are read at the end), **Proyección anual** (monthly cost × 12). No extra API calls. |
| "¿Cuánto cuesta cada ticket?" | Histogram of cost per ticket with the mean and the outlier limit (mean + 2 standard deviations); outlier bars are orange. Hover tooltips. |
| "¿Dónde se gasta?" | Cost by Meta market (customer country), with share, tickets and rate. |
| "Costo por semana" | Weekly bar chart (Monday-based weeks; incomplete weeks drawn lighter). Costs here are before the free tier. |
| "Costo por número de WhatsApp" | Monthly cost per business number after its 1,000 free messages. |
| Filters | Bar above the headline: **Formulario, Marca, Grupo, Agente asignado, Etiqueta, Atendido por** (only bots/AI, AI then an agent, only agents). Options come from the period's WhatsApp tickets, with counts; a filter with fewer than two values is hidden. Every KPI, chart and list follows the filters except "Costo por número" and "Estimado vs. factura de Meta" (the free tier is per number, not per form or group). With filters, **Costo por mes** is the filtered tickets' share of the total monthly cost (`total × filtered gross cost ÷ total gross cost`), and a note shows the total. Filters are remembered per browser (`wa-cost:filters`). No extra API calls: the fields come with the ticket export. |
| "Desglose" | Table by Formulario, Marca, Grupo, Agente asignado, Etiqueta, Atendido por, Conversaciones por ticket, Organización, Estado del ticket, País del cliente, or any custom field with a short value ("Campo: …"). Columns: tickets, cost, share of cost, cost per ticket, sent per ticket, and cost per ticket vs. the previous period. Rows of filterable dimensions apply that filter when clicked (again to remove it); breaking down by a dimension that is filtered shows all its rows with the chosen one highlighted. A ticket with several tags counts in each. 12 rows, "Ver las N filas" for the rest. |
| "¿Cuándo se gasta?" | Heatmap of the cost of sent messages by weekday and hour (browser time zone). |
| "¿Quién envía más mensajes?" | Top 8 agents/bots by cost, with cost per ticket. Authors that the Users API does not return are labeled "Bot o automatización". |
| "Tickets fuera de lo normal" | Outlier tickets (above mean + 2 sd), clickable to open the ticket. "Ver más" shows up to 25. |
| "Estimado vs. factura de Meta" | One row per calendar month fully inside the data read (both periods; a 90-day run gives two or three): messages sent, estimate for that exact month after the free tier, an input for what Meta billed (WhatsApp Manager), and the difference (green within 10%). Typed amounts are saved for the team in the `meta_billing` setting with "Guardar ajustes para todo el equipo". Unfiltered. |
| Budget alert | With a monthly budget (Ajustes or the `monthly_budget` setting), a banner appears when the estimated monthly cost reaches 90% of it (red when over), and Costo por mes says what share of the budget it uses. Unfiltered. |
| CSV export | "Descargar tickets (CSV)": ticket, country, detected yes/no, business number, sent, received, rate, cost, form, brand, group, assigned agent, organization, status, tags, "atendido por", conversations, first and last message (local time), and one column per custom field with a short value. Follows the filters (file name ends in `-filtrado`). Semicolon-separated with a BOM, decimal comma (Spanish Excel). Cells starting with `= + - @` are prefixed with `'` to block formula injection. |
| "Ajustes" | Grouped as **Cálculo** (for the team), **Alertas y actualización** (for the team, with the save button) and **Tus preferencias** (language, per person). Default country for tickets without a detected one, number of business numbers (used only when numbers can't be detected), extra channels to count as WhatsApp, monthly budget, "Actualizar al abrir si los datos tienen más de N horas", and a button to save them for the whole team (see below). |
| "Compartir con el equipo" | Inside Ajustes. Saves the last complete calculation in a Zendesk custom object so every admin opens the same numbers and the ticket panel can compare (see [Shared results](#shared-results)). States: not available (plan without custom objects or no permission), "Activar y compartir" (creates the object), or on ("Compartir ahora"; each complete run is shared automatically). |
| Auto refresh | With `auto_refresh_hours` set, opening the dashboard with a last calculation older than that starts "Ver costo" by itself (an update run: only what is new). It runs only while an admin has the dashboard open: a Zendesk app cannot run on a schedule without a server. |
| Diagnostic | When a run finds no WhatsApp tickets, a notice lists the `channel / rel` labels of the tickets read (top 10), each with "Contar como WhatsApp" to add it to the extra channels. A new run is needed after adding one. |
| "¿Necesitas ayuda?" | Card at the end of the dashboard. "Contáctanos" opens a form with the person's name and email already filled in (`currentUser`), a message and a ticked "include technical details" (app version, language, Zendesk subdomain, last calculation status, source and WhatsApp ticket count, shared results state, browser; no customer data). `SUPPORT` in `app.js`: with `zendesk` set to a Zendesk subdomain whose Help Center accepts requests from anyone, the message is sent automatically as a request there (`POST /api/v2/requests.json`, anonymous) and Zendesk emails the team; while it is `null`, the agent's mail app opens with the message ready for `delivery.zenter@zenital.co`. |
| "Cómo se calcula" | Plain-language explanation of the method and its limits. |

### Demo mode (setting `demo_mode`)

For webinars and demos. An admin ticks **Demo mode** in Admin Center → Apps → Costo de WhatsApp; both the dashboard and the ticket panel then run on a simulated WhatsApp account and nothing is read from, or written to, the real one. Untick it to go back to real data. It is a setting of the installation, so it applies to every agent.

- **Same code, fake account.** `assets/demo.js` answers the Zendesk paths the app already calls (ticket export with cursor pages, conversation logs in the production shape, users, installation settings). The progress card, partial results, update runs, "Cancelar", cache, CSV, outliers, charts, 7/30/90 days and custom ranges all work as with real data.
- **The data.** About 18 tickets a day for 200 days (78% WhatsApp, the rest email/web), customers from 9 countries, two business numbers, five agents plus an AI agent, a few very long conversations (outliers), conversations that continue days later, some tickets without a known country. Deterministic: the same ticket always has the same conversation. A 30-day run takes about 4 s, 90 days about 15 s.
- **Marked as simulated.** A "Modo de prueba" badge sits next to the dashboard title and above the ticket panel. Results are cached under separate browser keys, so demo and real numbers never mix.
- **Ticket panel.** Any open ticket shows a WhatsApp conversation generated from its id (always the same one). A new, unsaved ticket still shows "Sin costo de WhatsApp".
- **Differences from live mode (on purpose).** "Guardar ajustes para todos los agentes" saves only to this browser (`wa-cost:demo:settings`), never to the installation, and never saves `demo_mode`. Clicking an outlier ticket explains that demo tickets do not exist in Zendesk instead of opening one.

### Ticket sidebar (`ticket_sidebar`, flexible)

Works for agents. Reads the ticket's conversation from the agent interface (`ticket.conversation`, which includes messaging messages) and shows the WhatsApp cost of the open ticket: `US$ X`, the formula (`N mensajes × US$ rate`), sent and received counts and the customer country ("(supuesto)" when assumed). Shows "Sin costo de WhatsApp" for non-WhatsApp tickets and new (unsaved) tickets. Recalculates 1.5 s after the conversation changes.

Below the cost it compares the ticket with the last dashboard calculation: average cost of a WhatsApp ticket, and of its form and its group when they had at least 5 tickets (`2,1×` in orange, "debajo" in green). The averages come from the shared results (`benchmarks` record) when they are on, else from a dashboard run in the same browser (`wa-cost:benchmarks`); without either, the comparison is not shown. Form, brand and group come from `client.get('ticket.form.id')`, `ticket.brand.id` and `ticket.assignee` (its `group.id`).

### Shared results

Browser storage is per person, so without this each admin waits for their own first run, and agents' ticket panels have no averages. With it, the last complete calculation lives in a Zendesk [custom object](https://developer.zendesk.com/api-reference/custom-data/introduction/) `wa_cost_snapshot` ("WhatsApp Cost (app data)") with one `textarea` field `data`:

- Needs Zendesk Suite Team or above (custom objects); it uses one of the plan's custom objects (Team allows 3). Only admins create the object and field; agents can read records with the default permissions of Team, Growth and Professional.
- "Activar y compartir" creates the object and field (`POST /api/v2/custom_objects`, `POST /api/v2/custom_objects/wa_cost_snapshot/fields`) and publishes.
- Publishing gzips the same JSON the browser cache holds (`CompressionStream`), base64-encodes it and splits it into records of 28,000 characters (records are limited to 32 KB): `result-a-0…` or `result-b-0…`, alternating, then `result-meta` (`{ gen, parts, savedAt }`) last, so a reader never mixes two results. A 90-day demo run takes about 5 records. `benchmarks` holds the averages for the ticket panel (plain JSON, under 2 KB).
- On open, the dashboard reads `result-meta`; if the shared copy is newer than the browser's, it loads it ("Abierto desde los datos compartidos por el equipo") and keeps it as the base for the next update run.
- Old records of the other generation are overwritten, never deleted.

---

## Languages

The interface is in Spanish, English or Brazilian Portuguese:

- **Which one:** the choice in Ajustes → Idioma (per person, in this browser: `wa-cost:lang`), else the agent's Zendesk language (`client.get('currentUser.locale')`: `es`, `es-419`… → Spanish; `pt-BR`, `pt` → Portuguese; anything else → English). The ticket panel follows the same rule.
- **How:** texts in the code and pages are the Spanish ones. `assets/i18n.js` translates them with `assets/i18n-dict.js` (English and Portuguese, 339 texts) and falls back to Spanish; `{name}` placeholders are filled in. Fixed page texts are translated in place (`translatePage`). Numbers, dates, month and weekday names follow the language (`toLocaleString`). Market names: `rates.name(market, lang)`.
- **CSV:** `;` and decimal comma in Spanish and Portuguese, `,` and decimal point in English.
- **Demo mode** names (forms, groups, AI agent, customers) follow the language too.
- **Adding or changing a text:** write it in Spanish in the code, add its English and Portuguese row to `dev/i18n/rows.py`, run `python3 dev/i18n/build.py` (it rebuilds `assets/i18n-dict.js` and lists texts without a row), and run the tests: `features.test.js` checks that every translation keeps the placeholders of its Spanish text.
- **Admin Center texts** (app name, descriptions, setting labels) are in `translations/en.json`, `es.json` and `pt-br.json`. The Marketplace listing shows only English.

## Zendesk Marketplace

What the app has for a Marketplace submission, and what is left. Sources: [submit your app](https://developer.zendesk.com/documentation/marketplace/publishing-to-the-marketplace/submit-your-app/), [brand assets](https://developer.zendesk.com/documentation/marketplace/building-a-marketplace-app/create-app-brand-assets/), [listing content](https://developer.zendesk.com/documentation/marketplace/building-a-marketplace-app/create-content/), [manifest](https://developer.zendesk.com/documentation/apps/app-developer-guide/manifest/) (November 2026).

**Done in the app**
- `sh dev/package.sh marketplace` builds `dist/zd-message-counter-marketplace.zip` with `"private": false` (copy in `releases/zd-message-counter-vX.Y.Z-marketplace.zip`); `sh dev/package.sh` builds the private one. The zip holds only `manifest.json`, `assets/` and `translations/`.
- Name "WhatsApp Cost by Zenital" (≤40 characters, no Zendesk trademark). `defaultLocale: "en"`, `frameworkVersion: "2.0"`, version.
- `assets/logo.png` 320×320 (square, white background), `assets/logo-small.png` 128×128 transparent PNG, `assets/icon_nav_bar.svg` (monochrome path, no fill, square viewBox; required for `nav_bar`). Drawn from the Zenital Z (vectorized from the brand PNG).
- `assets/screenshot-0.png`, `-1`, `-2`: 1024×768, English, demo data. Rebuild with headless Chrome against the local preview (1024×768, `--virtual-time-budget=40000`): `index.html?demo=1&locale=en-US&autorun=1` (`&scroll=breakdown-card`) and `marketplace-shot.html`.
- Long descriptions in three languages with the data disclosure the Marketplace asks for (what is read, why, where it is stored). Short description ≤80 characters; long descriptions (2,400–2,600 characters) and installation instructions (≈850) under the stricter 3,000-character limit of the deploying guide.
- Support contact (`author.email`): delivery.zenter@zenital.co.
- No API tokens, OAuth clients, servers or third-party calls: every request is `client.request` to the customer's own Zendesk. No `console.log`; errors log only a status code. `app.willDestroy` stops a running calculation.
- Stored results (browser and shared custom object) keep the customer's country, not their phone or name.
- [Garden](https://garden.zendesk.com) structure with Zenital colors: `assets/style.css` keeps the Garden 9 default theme values for everything but color (`@zendeskgarden/react-theming` 9.16): system font 14/20 px for body text, 4 px radius for controls and 8 px for cards, 40 px buttons and inputs (32 px compact selects), the Garden focus ring (1 px spacer + 3 px primary), button group for the period, tags, tables and alerts. Colors are Zenital's (blue #0556CF, petrol #03363D, greys, greens, light blue #D6EEF1), adjusted where needed so every text passes WCAG AA (4.5:1) in light and dark mode; warning orange and danger red stay Garden's. Headings and key figures use Poppins from a bundled 10 KB subset (no font CDN, so no request leaves Zendesk). No React and no Garden package at runtime. The Zenital Z stays as the app logo.

**Zendesk is closing the Incremental APIs to third-party apps** ([announcement](https://support.zendesk.com/hc/en-us/articles/11275429993498): rollout December 2, 2026 – January 19, 2027; "all third-party apps and integrations … whether or not they are listed on the Zendesk Marketplace"; internal integrations exempt). Whether it covers requests a Zendesk app makes in the browser with the admin's session is not stated. The app no longer depends on it:
- Full and extend runs already use the Search Export API when all WhatsApp tickets are native.
- If the incremental export answers 403, 404 or 410 before its first page, tickets are listed with `GET /api/v2/tickets.json?page[size]=100&sort=-updated_at` (agents; sorted by last update; its own rate limit, 650 ms apart) until the updates are older than the period. The dashboard says so. Limits of that path: archived tickets are not listed and deleted tickets are not reported (their old messages stay until a full run).
- Admins can request a 60-day extension for a partner in Admin Center → Apps and integrations → APIs → API configuration.

**Left to do (outside the code)**
1. Register Zenital at apps.zendesk.com, create the Marketplace profile ("App developer"), get a `d3v-` sponsored test account.
2. Privacy policy URL (optional field, recommended). Terms URL only for a paid app.
3. `zcli apps:validate` / `zcli apps:package` need a Zendesk account that allows `/api/v2/apps/*` (both a Zenital test account and a sponsored test account answered 403, rechecked for 1.0.0); run it on the sponsored test account, or rely on the automatic check of the upload form (errors in red block the submission), then upload at apps.zendesk.com → Apps → Submit a new app, pick up to 2 categories, answer the compliance questions.
4. Review takes 1–3 weeks; add support@appsubmission.zendesk.com to contacts.
5. "WhatsApp" in the app name: Zendesk's pages only forbid Zendesk trademarks; they say nothing about third-party ones. Meta's brand rules for WhatsApp may still apply. Before submitting, confirm with partner_support@zendesk.com or rename to a descriptive form such as "Cost Tracker for WhatsApp" (edit `name` in `translations/*.json`).

## How the cost is calculated

1. **Where the messages come from** (finding the tickets: see also *Search Export* below): Zendesk does not store messaging conversations (native WhatsApp included) as ticket comments; the comments API and comment events don't return them ([Apps Support API](https://developer.zendesk.com/api-reference/apps/apps-support-api/ticket_sidebar/), [help article](https://support.zendesk.com/hc/en-us/articles/7513261399706)). The app therefore:
   - **Dashboard:** reads the [Incremental Ticket Export](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/) (cursor) from the start of the previous period, keeps **WhatsApp tickets** (the ticket's `via` mentions "whatsapp" anywhere, or its `channel / rel` label is in `whatsapp_channels`), and reads each one's [Conversation Log](https://developer.zendesk.com/api-reference/ticketing/tickets/conversation_log/). Every `Messaging::ConversationMessage` in the range is one WhatsApp message. Tickets whose log has no messaging messages (third-party integrations that write comments) fall back to their public comments.
   - **Sidebar:** `client.get('ticket.conversation')`; items whose `channel.name` is `whatsapp` (or a listed channel) count.
2. **Inbound vs. outbound:** conversation log `author.type` `end-user` (the docs say `user`; both are accepted; sidebar: `author.role` `end-user`) is the customer and free. `agent`, `system` and `bot` (sidebar: agent, admin, system, trigger) are charged: AI agent and bot replies cost the same as agent replies. Only `Messaging::ConversationMessage` events count; `Comment` events (internal notes, email replies) are ignored.
3. **Rate:** each outbound message is charged at Meta's **service message** rate (USD) for the customer's market. Since 2026-10-01 Meta charges every delivered service message, at the same rate as utility messages, with no volume tiers; utility templates sent inside the 24 h window are charged at that rate too ([Meta: non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)). Rates live in `assets/rates.js`, effective **2026-10-01**, from the "USD list rates" file at <https://developers.facebook.com/docs/whatsapp/pricing>. 47 markets.
4. **Customer country:** the ticket's `via.source.from` (the customer who started the conversation), mapped by calling code (`marketForPhone`), as Meta prices by the recipient's calling code. Falls back to the customer's or requester's profile phone. On a Zenital test account native WhatsApp tickets have an empty `via.source.from/to`, so in practice the profile phone or the default country decides. Special cases: +1 area codes of Dominican Republic, Jamaica and Puerto Rico → "Rest of Latin America"; +7 6xx/7xx → Kazakhstan, rest of +7 → Russia. Local numbers without a country code are treated as unknown.
5. **Unknown country:** uses, in order: the "Default country" setting (if an admin chose one, it wins) → the country of the ticket's business number (customers usually write to a local number; ignored when it maps to "Other") → the most common detected country in the period (dashboard) or from the last dashboard run in the same browser (sidebar) → "Other". Saving the default country from the dashboard makes both consistent for everyone.
6. **Business number:** the ticket's `via.source.to`; when it is empty (as on a Zenital test account), the `source.integration_id` of the customer's messages in the conversation log (one messaging integration per WhatsApp number), shown as "Número de WhatsApp (integración …abc123)". Only when neither exists is the count from Ajustes used.
7. **Cost per ticket:** outbound messages × rate. Does **not** subtract free messages.
8. **Monthly cost:** per business number (Meta: "Each business phone number has one free tier of 1,000 delivered service messages per month"; no rollover), `max(0, messages per month − 1,000) × average rate`, where messages per month = period messages ÷ period days × 30. If no number is detected at all, the number count from Ajustes is used (1,000 free × N). If some numbers are detected, unidentified messages get no extra free allowance.
9. **Previous period:** the same length immediately before; read in the same API pass.
10. **Conversations and "atendido por":** messages of a ticket more than 24 h apart start another conversation (Meta's customer-service window). A ticket is "Solo IA o bots" when every message sent in the period came from a bot/AI author, "IA y después un agente" when both, "Solo agentes" when no bot.
11. **Ticket fields:** form, brand, group, assignee, organization, status, tags (first 30) and custom fields whose value is 80 characters or less come from the same ticket export, as they are at the time of the run (a ticket moved to another group counts there). Names: `GET /api/v2/ticket_forms.json`, `/brands.json`, `/groups.json`, `/ticket_fields.json` and `/organizations/show_many.json`, once per run; a call that fails leaves ids (`Formulario #123`).

### Performance

- **Search Export for full and extend runs.** When the last complete run found only native WhatsApp tickets (`nativeOnly`) and no extra channels are listed, tickets are found with `GET /api/v2/search/export.json?filter[type]=ticket&page[size]=1000&query=via:whatsapp updated>=<ISO time>` (100 requests per minute, agents) instead of the incremental export of every ticket of the account (10 per minute, 6.5 s apart). If the search fails, returns objects without `via`/`updated_at`, or finds no WhatsApp ticket, the run falls back to the export. The search index can lag a few minutes, so a result found by search counts as complete only up to 15 minutes before its end; the next update run (always by export) reads those minutes again. Update runs use the export, which also reports deleted tickets.
- **Both steps at once:** conversation logs are read while tickets are still being listed (the export pauses 6.5 s between pages; logs fill those pauses). The progress card shows "N de M encontrados hasta ahora". On a large account this saves most of step 1.
- **Current period first:** tickets updated inside the chosen period go to the front of the queue; the previous period, which only feeds the comparison, is read last. The chosen period is final about halfway through a first run.
- **Fewer profile lookups:** customer profiles are requested only for tickets whose via has no customer phone (a name such as "WhatsApp Business" does not count), and a profile without a phone is remembered (`''`) so later runs don't ask again.
- **Conversation log pace:** 3 at a time, 640 ms apart per request (about 94 per minute, limit 100). After a 429 the spacing grows ×1.5 for the rest of the run (up to 3 s).
- **Messages are appended in place** (`push`), not with `concat`, which copied the whole list once per ticket: 6.9 s → 4 ms to collect 400,000 messages.
- **Dashboard:** country and business number per ticket are worked out once per result (`prepare`), the default country comes from a single pass (`commonMarket`) instead of two extra analyses, and analyses are memoized by their inputs: a keystroke in Ajustes or a filter already used re-renders without reading the messages again.
- **Browser cache is gzipped** (`gz:` + base64, via `CompressionStream`): the 90-day demo result goes from 1.5 MB to 340 KB, so large accounts stay under the ~5 MB browser storage limit. Plain JSON caches from 0.15 still open.
- **Shared results:** `peek` and `load` reuse one listing of the records (30 s). The ticket panel keeps the shared averages in `wa-cost:benchmarks:shared` for 6 hours instead of listing every shared record (the whole result) on each ticket it opens.

### Sample estimates

The conversation log limit (100 requests per minute) makes a full read of a large account slow: about 5,600 tickets per hour. A sample trades exactness for time.

- **Time estimate:** before a full run (no usable earlier result), `countTickets` asks `GET /api/v2/search/count.json?query=type:ticket via:whatsapp updated>=<previous period start>` and `readMinutes(n)` turns the count into minutes at 640 ms per log. Under 5 minutes the run starts as before; otherwise the "¿Calcular todo o estimar con una muestra?" card shows the count, the time, a sample-size slider (100 tickets up to all, with its time) and two buttons: "Estimar con la muestra" and "Calcular todo (N min)". The count leaves out integrations listed in the channels setting (the card says so). If the count fails, the run starts as before.
- **Drawing the sample:** `countMessages({ sampleSize })` lists every WhatsApp ticket as usual, gives each a random number and, once the list is complete, reads the logs of the first `sampleSize` in that random order (a simple random sample of both periods). The result carries `sample: { rows, read, start, end }`: every ticket listed in sample order and how many of the first ones were read.
- **Scaling up:** `analyze` passes the sample to `summarize`. For each period, `sampleDomain` counts the tickets that may have messages in it (updated since its start, created before its end): N listed, n read, weight w = N / n. Totals (messages, cost, per country, number, sender, week, hour) are multiplied by w; per-ticket figures (histogram, outliers, average per ticket) stay those of the tickets read; ticket counts are shown as "≈ N".
- **Margin, in US$:** `sampleMargin` is the 95% margin of an estimated total from a simple random sample without replacement: 1.96 × N × √((1 − n/N) × s² / n), where s² is the sample variance of the cost per ticket (tickets read with no cost count as 0). The dashboard shows it per month (× 30 / days): in the sample card, in the headline ("US$ 27,13 ± US$ 5,04 por mes") and under "Costo por mes". `breakdown` gives every row its own margin (same formula with the row's tickets only), shown under its cost. With filters, the totals and their margin are those of the filtered tickets.
- **Extending:** the sample card ("Estimación con una muestra") has a slider "Sumar a la muestra" (50 tickets up to all that are left), the time it takes and the margin expected afterwards (`projectMargin`, same spread), plus "Extender la muestra" and "Calcular todo (N min)". `extendSample` reads the next tickets of the stored random order only (`countMessages({ rows })`, no listing), so the sample stays random and nothing is read twice. Reading every ticket left gives exactly the result of a full run (tested), which then becomes the base for update runs. A cancelled extension keeps what it read as a smaller sample.
- **What a sample is not:** never the base of an update run (`planRun` treats it as no result), never published as shared results, and not refreshed automatically. It is kept in the browser cache, with customer phones masked like the rest, so it can be extended after reopening the app.

### What it cannot measure

- **Marketing and authentication templates** have other rates; Zendesk does not say which messages are templates (utility templates inside the window cost the same as service messages).
- **Free entry point:** conversations started from a Click-to-WhatsApp ad or Facebook Page CTA are free for up to 7 days; Zendesk does not expose this.
- **Delivery status:** Meta charges delivered messages only; failed messages are counted here.
- **Bot messages before the ticket exists:** on a Zenital test account the AI agent's pre-handoff messages do appear in the ticket's conversation log and are counted. Not checked for other bot setups.

For exact figures, compare with Meta billing in WhatsApp Manager. This app is an estimate.

---

## Settings (Admin Center → Apps → Costo de WhatsApp)

| Setting | Type | Use |
|---|---|---|
| `default_market` | text | Country/market for tickets without a detected customer country. Accepts English or Spanish names (`Argentina`, `México`, `Rest of Latin America`, `Resto de Latinoamérica`). Can also be saved from the dashboard. |
| `business_numbers` | number (default 1) | Number of WhatsApp business numbers. Only used when messages don't carry the business number. |
| `demo_mode` | checkbox (unticked = off) | Demo mode: simulated data in the dashboard and the ticket panel (see [Demo mode](#demo-mode-setting-demo_mode)). Needs the app updated to 0.14.0, since it is a new setting. |
| `monthly_budget` | number | Optional monthly WhatsApp budget in USD for the budget alert. Can also be saved from the dashboard. |
| `meta_billing` | text | What Meta billed per month, `YYYY-MM=amount` comma-separated (`2026-10=123.45, 2026-09=98.10`). Filled from the "Estimado vs. factura de Meta" card. |
| `auto_refresh_hours` | number | Optional. Opening the dashboard with data older than this many hours starts an update run. Empty or 0: never. |
| `whatsapp_channels` | text | Optional, comma-separated `channel` or `channel / rel` labels to count as WhatsApp when automatic detection misses it (e.g. `native_messaging`). Use the labels shown by the dashboard diagnostic. Can also be saved from the dashboard. |

The dashboard's "Guardar ajustes para todos los agentes" button (shown when the country or channels in use differ from the saved ones) calls `GET` then `PUT /api/v2/apps/installations/{id}.json`, sending back all current settings plus `default_market` and `whatsapp_channels` (the API docs don't say whether a partial `settings` object merges or replaces). Requires an admin. **Untested against the real API:** after the first use, check in Admin Center that the other settings are unchanged.

---

## Permissions and API usage

| Call | Where | Who | Notes |
|---|---|---|---|
| `GET /api/v2/incremental/tickets/cursor.json` | Dashboard | Admins | Max 10 requests/min, 1,000 tickets per page. Pages are spaced 6.5 s apart (load time counts toward the pause). |
| `GET /api/v2/search/export.json` | Dashboard | Agents | Full and extend runs when all WhatsApp tickets are native (see Performance). 100 requests/min; 1,000 per page, 0.7 s apart. |
| `GET /api/v2/search/count.json?query=type:ticket via:whatsapp updated>=…` | Dashboard | Agents | Once before a full run, for the time estimate. Search API limits. |
| `GET /api/v2/tickets/{id}/conversation_log` (no `.json`, no `page[size]`) | Dashboard | Agents | Own limit: 100 requests/min per account. The app reads 3 tickets at a time, 0.64 s apart per request, slower after a 429. If the first 6 logs all answer 404, the run stops with "Zendesk no devuelve el historial de conversaciones en esta cuenta" instead of crawling through comments. A 404 (`RecordNotFound`, e.g. archived tickets) does not stop the run: that ticket falls back to its public comments and the dashboard says how many logs were missing. Tickets with status `deleted` are skipped. |
| `GET /api/v2/tickets/{id}/comments.json` | Dashboard | Agents | Only for WhatsApp tickets without messaging messages. |
| `GET /api/v2/users/show_many.json` | Both | Agents | 100 ids per call, 3 calls at a time; users already known from the cached result are not requested again. |
| `GET /api/v2/tickets/{id}.json` + `client.get('ticket.conversation')` | Sidebar | Agents | Ticket `via` for phones; conversation for messages. |
| `GET/PUT /api/v2/apps/installations/{id}.json` | Dashboard (button) | Admins | Save default country, channels, budget, Meta invoices, auto refresh. |
| `GET /api/v2/ticket_forms.json`, `brands.json`, `groups.json?page[size]=100`, `ticket_fields.json?page[size]=100`, `organizations/show_many.json` | Dashboard | Agents (forms, fields: admins may be needed on some plans) | Names for filters and breakdowns, once at the end of a complete run. Optional: failures are ignored. |
| `GET/POST /api/v2/custom_objects…`, `GET/POST/PATCH …/wa_cost_snapshot/records` | Dashboard, sidebar | Admins create; agents read and write records | Shared results (opt-in). The sidebar only reads (`benchmarks`). |
| `client.get('ticket.form.id', 'ticket.brand.id', 'ticket.assignee')` | Sidebar | Agents | Form, brand and group for the comparison; optional. |

In demo mode none of these calls reach Zendesk.

Errors other than these 404s stop the run and show the status and path (e.g. "error 500 en /api/v2/…"); the full error is logged to the browser console. Every API call retries a 429 up to 3 times (honors `Retry-After`, default 60 s). All calls go through `client.request` as the logged-in user. No API tokens or secrets are stored in the app.

A first 30-day run reads 60 days (current + previous period): ticket export pages at 10/min, then one conversation log per WhatsApp ticket at about 85/min. Example: 3,000 WhatsApp tickets ≈ 35–40 minutes the first time. A 90-day run reads 180 days. Later runs reuse the cached result (see Update runs). The ticket sidebar loads settings, ticket and requester in parallel.

---

## Install / update

1. Build the package (from the project folder):

   ```bash
   rm -f dist/zd-message-counter.zip && zip -rq dist/zd-message-counter.zip manifest.json assets translations -x '.*'
   ```

2. Upload it manually: **Admin Center → Apps and integrations → Zendesk Support apps → Private apps** → *Upload private app* (first time) or open the app → *Update* (new version). Bump `version` in `manifest.json` on every update.
3. Enable the app; the ticket sidebar location is included.

`zcli apps:*` currently fails with **403 Forbidden** on Zenital's test accounts, even after re-login and zcli 2.3.0. Cause unknown; manual upload works. The `tmp/` folder holds a leftover zcli package and can be deleted.

---

## Project structure

```
manifest.json            App definition: nav_bar + ticket_sidebar, 7 settings
translations/en.json     App name, descriptions, setting labels
assets/
  iframe.html, app.js    Dashboard UI and logic
  ticket.html, ticket.js Ticket sidebar
  counter.js             Core logic (no DOM): date ranges, export reader, ticket fields and names, update runs, analysis (filters, conversations, hours, months), breakdowns, benchmarks, free tier, stats, CSV, cache packing, Meta invoices
  share.js               Shared results in a custom object: setup, gzip + split publish, load, benchmarks
  i18n.js, i18n-dict.js  Interface language (es / en / pt-BR) and the English and Portuguese texts
  icon_nav_bar.svg       Left navigation icon (Zenital Z, monochrome)
  screenshot-0..2.png    Marketplace screenshots (1024x768, English, demo data)
  demo.js                Demo mode: fake Zendesk account (export with forms/brands/groups/tags/fields, logs, users, names, settings, custom objects) and the ticket panel's demo conversation
  rates.js               Meta rate table, calling-code → market map, Spanish names
  chart.js               SVG histogram, weekly bars, day × hour heatmap
  style.css              Light/dark tokens and all styles
  logo.png, logo-small.png  Zenital Z app icons (320 px on white, 128 px transparent)
tests/                   Unit tests (node:test): counter.test.js (counter.js, rates.js), range.test.js (dates, update runs), demo.test.js, features.test.js (0.15 features)
dev/stub.js, preview.sh  Local preview with a fake ZAF client (not packaged); ?locale=, ?autorun= for screenshots
dev/package.sh           Builds the private zip, or the Marketplace one (`marketplace`)
dev/i18n/                Translation table (rows.py) and the script that builds assets/i18n-dict.js
dev/marketplace-shot.html  Layout of Marketplace screenshot 3
releases/               Every built version: zd-message-counter-vX.Y.Z.zip (private) and -marketplace.zip
dist/                    Built zip
```

No build step and no dependencies: plain ES5-style JavaScript plus the ZAF SDK from Zendesk's CDN.

---

## Development

**Tests** (Node 18+):

```bash
node --test tests/*.test.js
```

73 tests (0.18 adds: List Tickets fallback, translations keep their placeholders, language from the Zendesk locale, stored results without customer phones or names). Since 0.17 also: logs read before the export ends, the current period announced complete with its final numbers before the previous period's logs, and profile lookups only when needed and once. `features.test.js` covers the run plans (a range inside the last result makes no calls and matches a fresh read; extending 30 → 90 days skips logs and matches a full read; an update keeps the longer history; other channels or no overlap read everything), Search Export (same tickets and numbers as the export; fallback on errors, thin objects, no results, or listed channels), the log pace after a 429 and spaced partial results, the single-pass default country, and ticket fields and names (and failed name calls), filters (parts add up to the total in both periods), breakdowns, "atendido por", conversations, cost by hour, calendar months, Meta invoice parsing, benchmarks, business number from `integration_id`, update runs keeping fields, and shared results (setup, gzip round trip, records under 32 KB, alternating generations, no custom objects). `range.test.js` checks date ranges in six time zones (daylight saving included), the exact day boundaries, and that an update run gives the same numbers as a full run of the same period over a sequence of periods and days. `demo.test.js` runs the real dashboard flow on the demo account (realistic figures, paging, determinism, dates, update runs, settings that may and may not be saved, the ticket panel). `counter.test.js` covers: ticket export + conversation log reading (bots, comment fallback, phones from the ticket via), the log as production returns it (`end-user`, AI agent as `system`, `Comment` events ignored), 404 fallback and early stop, listed channels, update runs (re-read tickets replace old messages), requester-phone and business-number country fallbacks, analysis by ticket/market/number/author/week/previous period, free tier, stop/stalled cursor, 429 retry, comments without a time, outliers, single-ticket cost, CSV escaping, cache pack/unpack, phone → market, market names.

**Local preview** (dashboard only):

```bash
sh dev/preview.sh
```

Then open <http://localhost:8765/index.html>. `dev/stub.js` replaces the ZAF SDK with a fake client: 80 WhatsApp tickets over the last 55 days, conversation logs in the production shape (customer, AI agent, three agents) with a 250 ms delay each, so the progress card and partial results are visible. Clear the browser's local storage to see the empty state again.

- `?demo=1` turns the `demo_mode` setting on. Every request that still reaches the stub in demo mode fails and is listed in `window.__zafRequests`, so a leak to the real API is visible (it should stay empty).
- The ticket panel is at `ticket-preview.html` (`?ticket=1067` sets the open ticket; add `&demo=1` for demo mode).

**Updating Meta rates:** edit `SERVICE_USD` and `EFFECTIVE` in `assets/rates.js`, check `CODES`/`REGIONS` against Meta's calling-code table, update the date text in `app.js` (`els.ratesDate`), and run the tests.

**Browser storage keys** (per user, per browser): `wa-cost:last:v4` (last complete result, gzipped compact JSON since 0.16; skipped if still too big; v3 from 0.13 is deleted on open because update runs had lost messages in it) and `wa-cost:common-market` (read by the sidebar). `wa-cost:benchmarks` (averages for the ticket panel), `wa-cost:benchmarks:shared` (shared averages kept by the ticket panel for 6 h), `wa-cost:filters` and `wa-cost:dimension` (filters and breakdown chosen). Demo mode uses its own copies (`…:demo`), plus `wa-cost:demo:settings` (settings saved while in demo mode) and `wa-cost:demo:objects` (the demo account's custom object records). The 0.15 cache keeps the v4 key: older v4 results open without ticket fields until the next run (the breakdown says so).

---

## Verified on a Zenital test account

Checked by hand with the API in the browser (November 2026):

- Native WhatsApp tickets have `via.channel` `whatsapp` and `from_messaging_channel: true`. Search `type:ticket via:whatsapp` finds them (93 on that account).
- `via.source.from` and `via.source.to` are empty (`{}`) on those tickets.
- `GET /api/v2/tickets/{id}/conversation_log` answers 200; with `?page[size]=100` it answered 404 on a production account.
- Ticket 1067's log holds every WhatsApp message (customer, AI agent and agents) as `Messaging::ConversationMessage`, plus `Comment` events for internal notes and an email reply, which the app ignores. Author types seen: `end-user` (source `whatsapp`, with `integration_id`), `system` with user id -1 for the AI agent (source `ultimate`), `agent` (source `zd:agentWorkspace` or `zd:agentCopilot`).
- The ticket's comments only hold transcripts of those messages (`via.channel` `chat_transcript`, author -1), so they are not a usable source.

## Unverified assumptions

1. Each `Messaging::ConversationMessage` is one delivered WhatsApp message (a text plus an image sent separately are two).
2. WhatsApp through third-party integrations (Infobip, Twilio, etc.) is detected by `via` or a `whatsapp_channels` label, and its messages are in the conversation log or the public comments.
3. The Incremental Ticket Export marks a ticket as updated when a new messaging message arrives (needed for update runs).
4. CSV download works inside the Zendesk app iframe.
5. Saving settings via the installations API keeps the other settings.
6. A full dashboard run on a Zenital test account matches the counts read by hand (e.g. ticket 1067: 16 messaging messages, 7 charged).
7. The cursor ticket export includes `ticket_form_id` and `brand_id` (the docs' cursor example shows `group_id`, `assignee_id`, `organization_id`, `tags` and `custom_fields`, not those two; the Tickets schema lists them). Without them the Formulario and Marca filters stay hidden.
8. `source.integration_id` of customer messages identifies the business number (one WhatsApp integration per number). Seen on a Zenital test account with a single number; not checked with two.
9. Shared results (custom objects): the API paths, body shapes, the 32 KB record limit and the agent permissions are from the docs (November 2026); nothing has run against a real account yet. A `textarea` value of 28,000 characters is assumed to be accepted (the docs give no per-field limit).
10. `client.get('ticket.form.id')`, `ticket.brand.id` and `ticket.assignee` return form, brand and group in the sidebar (both shapes the docs show are handled).
11. `GET /api/v2/groups.json?page[size]=100` and `ticket_fields.json?page[size]=100` accept cursor pagination; offset `next_page` is followed too.
12. `via:whatsapp` finds every native WhatsApp ticket in search (checked by hand on a Zenital test account in the agent search, not through Search Export; the search reference documents `via:native_messaging`, not `whatsapp`). If it finds none, the run falls back to the export, so the risk is a partial list, not an empty one. Search Export results are assumed to be full ticket objects (the docs don't list the fields; the app checks `via` and `updated_at` and falls back otherwise).
13. The Conversation Log limit of 100 requests per minute (the app's pace relies on it; its docs page could not be read in November 2026).

---

## Ideas / next steps

- **Count business numbers by API:** the Sunshine Conversations API can list messaging integrations filtered by WhatsApp. It needs a Conversations API key (Admin Center → Apps and integrations → Conversations API) stored as a secure setting.
- **Scheduled runs without a browser:** a small server or a Make/Zapier scenario that runs the same reading nightly and publishes the shared result; the app would only display it.
- **Names of business numbers:** the Sunshine Conversations integration list would turn "integración …abc123" into the real number.
- Detect template messages if Zendesk ever exposes them.

---

## Security notes

- No credentials in the code or settings.
- User-visible text is set with `textContent` (no HTML injection); CSV cells are formula-neutralized.

---

## UAT 1.0.0

Run on 2026-11-23 against the local preview in demo mode (`dev/preview.sh`), plus `node --test tests/*.test.js` (79 pass) and an independent code review.

| Area | Checked | Result |
|---|---|---|
| Package | `manifest.json` (name, author, support email, `defaultLocale` en, locations, parameters), `translations/en|es|pt-br.json` (name ≤ 40, short description ≤ 80, data disclosure), `logo.png` 320×320, `logo-small.png` 128×128 transparent, `icon_nav_bar.svg`, 3 screenshots 1024×768 | OK |
| Period and dates | 7/30/90 days, custom range; errors for empty, inverted and future dates; switching to a period the last result holds is instant, others say "haz clic en Ver costo" | OK |
| Time estimate | Card with count, time and slider for a full run of 5 min or more; "Cancelar"; closes when the period, dates or channels change; channel note when channels are listed | OK |
| Sample | Estimate with ≈ counts, ± US$ per month in headline, monthly cost, sample card and breakdown rows; extend with the slider; cancel mid-extension; "Calcular todo" equals a full run; never shared or used as the base; survives a reload next to the complete result | OK |
| Dashboard | Filters, every breakdown dimension, CSV export, budget alert, settings save (demo), sharing states, help form validation | OK |
| Languages | es (neutral), en, pt-BR: no untranslated text; demo names follow the language | OK |
| Look | Zenital colors, Poppins headings; every visible text ≥ 4.5:1 in light and dark; no horizontal scroll at 375 px | OK |
| Ticket panel | Cost, messages, country, comparison with form and group averages | OK |
| Security | No `innerHTML`/`eval`; external URLs: ZAF SDK, the two Zenital links (`rel="noopener noreferrer"`), the optional help Requests API; no tokens stored; customer phones masked in caches | OK |
| Console | No errors during the runs above | OK |

Not covered here: `zcli apps:validate` (the account answers 403 on `/api/v2/apps/*`) and a run on a real large account; both are steps before submitting.

## Version history

| Version | Changes |
|---|---|
| 1.0.0 | **Marketplace release.** UAT passed (see "UAT 1.0.0"). Fixes from the final review: no second run can start while the ticket count or a run is in progress; the time-estimate card closes when the period, dates or channels change; a sample is cached under its own key (`wa-cost:last:v4:sample`), so the last complete result stays the base for update runs, the shared copy no longer replaces a newer sample, and the ticket panel's averages come from complete calculations only; a period with fewer than 2 tickets read shows no margin ("—", with a note) instead of ± US$ 0; an extended sample keeps the time its tickets were listed; names are read when extending a sample that stopped early; no margin next to a monthly cost the free messages cover; in demo mode form, group and brand names follow the interface language. Listing texts mention the time estimate and samples; install step 4 points to **Settings > Share with the team**. |
| 0.23.1 | Next to "Contáctanos": links to Zenital's Zendesk partner page (https://www.zendesk.com/in/marketplace/partners/5473/) and https://www.zenital.co, opening in a new tab (`rel="noopener noreferrer"`). |
| 0.23.0 | **Zenital colors** on Garden's structure: blue #0556CF (primary, charts, headings), petrol #03363D (text), greys #859B9C / #C9D6D4 (borders, muted text darkened to AA), green #639C8E (good deltas, darkened to AA), light blue #D6EEF1 (info cards); dark mode on a petrol background. Headings and key figures in Poppins (bundled subset, `assets/poppins-semibold.woff`, SIL OFL in `assets/poppins-OFL.txt`; no external request). Every visible text checked for WCAG AA contrast in light and dark. Warning orange and danger red stay Garden's. New screenshots; `?autorun=1` now answers the time-estimate card (`&sample=N` for a sample). |
| 0.22.1 | Neutral Spanish: the interface, the Marketplace texts and the README quotes use tú instead of voseo ("Elige", "Intenta de nuevo", "haz clic en", "¿Necesitas ayuda?", "aquí"). English and Portuguese unchanged. |
| 0.22.0 | Time estimate before a full calculation (Search count) and sample estimates: a random sample of tickets with totals scaled up and a 95% margin of error in US$ (headline, monthly cost, breakdown rows); the sample can be extended with a slider or completed to the exact result without reading anything twice. |
| 0.21.1 | `logo-small.png` (also the dashboard header) back to the Z's original stroke weight; `icon_nav_bar.svg` only slightly thicker than the original so it reads at 18 px. |
| 0.21.0 | **Usability pass:** clicking 7/30/90 days shows a period the last calculation already holds at once (up to 30 minutes old; "Ver costo" still reads the newest minutes), and otherwise says "Elegiste 90 días: haz clic en Ver costo". "Ajustes" grouped into Cálculo, Alertas y actualización (with the save button right below, now primary) and Tus preferencias (language), then sharing. Collapsible sections have 40 px targets. Applying a filter is announced to screen readers. Checked: no text under WCAG AA contrast, every control labelled. |
| 0.20.0 | **Names instead of ids:** forms use their agent-facing name (`name`, not the end-user `display_name`); forms, brands and groups the lists did not return (inactive, deleted) are looked up one by one; results that still lack names ask Zendesk again when the dashboard opens; anything left reads "Formulario sin nombre (ID …828627)". **"¿Necesitas ayuda?"** contact form. "Guardar ajustes" appears only for settings changed here, not because the most common country changed. Spacing under tables, "$0" on chart axes. |
| 0.19.0 | **Garden look** for the Marketplace: Garden 9 palette, type, radii, button group, buttons, fields, tags, tables, alerts and focus ring, in light and dark mode; the main KPI is a card with a primary top bar instead of a blue gradient. New screenshots. |
| 0.18.0 | **Languages:** Spanish, English and Brazilian Portuguese (Zendesk profile language or a choice in Ajustes), dates, numbers, CSV and demo data included; `translations/es.json` and `pt-br.json`. **Zenital Z** icons (`logo.png`, `logo-small.png`, `icon_nav_bar.svg`). **Marketplace:** public build script, three screenshots, English name and descriptions with data disclosure. **Incremental export closing to third-party apps:** fallback to List Tickets. **Privacy:** stored results keep the customer's country instead of their phone and name. Errors log only a status code; a running calculation stops when the app closes. Shared custom object titled "WhatsApp Cost (app data)". |
| 0.17.0 | Conversation logs read while tickets are still being listed. The chosen period is read first and shown as final before the previous period (comparisons appear at the end). Customer profiles requested only when the country needs them, and once. |
| 0.16.0 | **Performance.** Results keep a data window: a period inside it opens with no API calls, a longer one only reads the earlier time and skips logs already held (30 → 90 days in the demo: 811 of 1,707 logs skipped), updates keep up to 180 days of history. Search Export finds native WhatsApp tickets (100/min) instead of exporting every ticket (10/min), with fallback. Conversation logs about 10% faster, slowing down after a 429. Messages appended in place (quadratic copy removed). Partial results at most every 3 s. Dashboard analyses memoized, default country in one pass. Browser cache gzipped (1.5 MB → 340 KB). Shared results downloaded once when opening the dashboard; the ticket panel keeps the shared averages for 6 hours. |
| 0.15.0 | **Granular breakdowns:** ticket form, brand, group, assignee, organization, status, tags and short custom fields are kept from the ticket export (no extra calls per ticket) with their names (five list calls per run). **Filters** by form, brand, group, assigned agent, tag and "atendido por" apply to every KPI and chart (monthly cost becomes the filtered share). **Desglose** table by any of those, conversations per ticket, organization, status, country or a custom field, with cost per ticket vs. the previous period; rows apply filters. **Bot vs. agent:** tickets answered only by AI, AI then an agent, or only agents. **Conversations:** 24 h windows per ticket. **Heatmap** of cost by weekday and hour. **CSV** with all those columns. **Free tier per real number** from the conversation log's `integration_id`. **Meta invoices:** month-by-month estimate vs. what Meta billed. **Monthly budget** with an alert. **Shared results** in a custom object (opt-in, Suite Team+), auto-shared after each complete run and opened by other admins. **Ticket panel** compares the ticket with the average of WhatsApp tickets, its form and its group. **Auto refresh** on open after N hours. New settings `monthly_budget`, `meta_billing`, `auto_refresh_hours`. Demo mode simulates all of it. |
| 0.14.0 | **Demo mode** (`demo_mode` setting): simulated account for webinars, same features as live mode. **Date fixes:** an update run ("Ver costo" again, or switching to a shorter period) dropped the older messages of every ticket that had new activity, so its numbers were lower than a full run's; it now re-reads each updated ticket from the start of the period. The dashboard blocked "Ver costo" silently when a hidden custom date was empty. Clear messages for empty dates, a `Desde` in the future and `Desde` after `Hasta`; a custom `Hasta` in the future is shown as the real last day. The "no WhatsApp tickets found" diagnostic no longer flashes during partial results. **Second pass:** a ticket listed on two export pages is read once (it was counted twice); national phone numbers with a trunk 0 (`011 5555 6666`) no longer count as "Other" countries; the saved cache remembers the period that was run, not the one selected when it finished; the ticket panel ignores a slow older load; the weekly chart no longer breaks on ranges over a year; the saved results of 0.13 are discarded (cache key v4). **Third pass (independent review):** weekly bars lost a day's cost in zones whose clocks skip midnight (Santiago, Cairo, Havana); an update run kept the old messages of tickets deleted since the last run; a cancelled update run made the next one drop the messages of the tickets it had not reached; after a cancelled or failed run the next "Ver costo" read everything again instead of extending the last complete result; "Ver costo" is disabled until the settings load (a click before that could reach the real account while demo mode was on); "Guardar ajustes" no longer writes a cached channel list over what another admin saved (channels are sent only if edited here); equal ticket costs no longer draw a fake curve; years before 2000 in a custom date are rejected; a first run that fails returns to the start screen; demo mode saves only the settings that changed. **Costo por mes:** a US$ 0,00 covered by Meta's free messages now shows the cost without them, and a 0 vs 0 comparison with the previous period reads "igual que el período anterior" instead of an empty card. **Simpler reading:** a one-line headline, shorter notes in the stats row, no "Sin datos del período anterior" pill when there is nothing to compare, and the histogram without the bell curve (the mean line, the outlier line and orange bars stay). Date logic moved to `counter.js` (`buildRange`, `reusableRun`, `runRange`) with tests. |
| 0.13.0 | Visual overhaul (Zenital header, gradient hero KPI, softer cards). Two-step progress bar (find tickets, read conversations) with live counts and time left. New stats row: messages sent (and per customer message), share sent by bots or AI, share of tickets with a known country, yearly projection. |
| 0.12.2 | Conversation log customers come as `author.type` `end-user` in production, not `user` as in the docs: customer messages were being counted as charged. AI agent messages (`system`, source `ultimate`) are labelled as bot. |
| 0.12.1 | Conversation log requested without `?page[size]=100`: in production the plain path (with or without `.json`) answered 200 in the browser while the app's request with that parameter answered 404. |
| 0.12.0 | Conversation log path without `.json` (v0.11.x got 404 on every ticket in production, e.g. `/api/v2/tickets/10253/conversation_log.json`); stop early when the log API is unavailable; comment fallback per ticket in parallel; partial results while loading. |
| 0.11.1 | A conversation log 404 (`RecordNotFound`) no longer stops the run; deleted tickets skipped; errors show status and path. First production run of 0.11.0 failed with `RecordNotFound`. |
| 0.11.0 | Reads messages from the Conversation Log API (dashboard) and `ticket.conversation` (sidebar) instead of ticket comments, which don't contain messaging messages; WhatsApp tickets found via the Incremental Ticket Export; requester phone fallback; texts updated to Meta's Oct 2026 rules (free entry point up to 7 days, utility = service rate). |
| 0.10.0 | Unknown customer country falls back to the business number's country; update runs read only new time; parallel user lookups; adaptive pause; parallel sidebar requests. |
| 0.9.0 | Ticket-level WhatsApp detection (deep `via` match, ticket event marks, replies from any interface), `whatsapp_channels` setting, diagnostic with "Contar como WhatsApp", business number per ticket. |
| 0.8.1 | Channel diagnostic when no WhatsApp is found. |
| 0.8.0 | Last result cache; save default country for all ticket sidebars. |
| 0.7.2 | Real progress bar; removed nav bar icon. |
| 0.7.1 | Fixes: 429 retry, comments without time, free tier for unidentified numbers, exact custom-range length, new-ticket sidebar. Zenital icons. |
| 0.7.0 | WhatsApp-only; cost per business number; previous-period deltas; cost per agent/bot; weekly chart; CSV export. |
| ≤ 0.6 | Executive dashboard, bell curve outliers, ticket sidebar, automatic rate by country. |
