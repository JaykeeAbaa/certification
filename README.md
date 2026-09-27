# Certify — local DICT certificate sender

Runs on your computer. No application account, hosted database, or cloud queue is required. Supply only your email sender's SMTP details and app password.

## Start the app

Install Node.js 22.13 or newer (Node 24 recommended). In this folder:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:3000. For development use `npm run dev` instead of build/start. The supplied commands bind only to your own computer. Keep the server terminal open and the computer awake while sending. Closing the browser is fine. Shutting down the server stops sending; queued messages resume when it restarts.

## Connect your sender

Open **Workspace settings**, enter your sender name, email, SMTP host, port, and app password, then click **Test connection & save**. This button is available immediately without logging in. Connection verification does not send an email. For Gmail use `smtp.gmail.com` with port 465 (TLS) or 587 (STARTTLS). The account must support app passwords. Spaces in pasted Gmail app passwords are removed automatically.

Defaults are 10 attempts/minute and 400 attempts per rolling 24 hours. Adjust these below your provider's allowance. Provider quotas and attachment limits still apply. SMTP hosts must resolve to public IPv4 addresses; TLS certificate checks are required.

## Send certificates

1. Create a campaign with training details.
2. Upload signed PDFs or a ZIP containing PDFs. Files are saved on this computer immediately. Import the participant CSV and map its columns.
3. Review certificate matches. Missing matches, duplicate emails, and reused certificates block sending until resolved or excluded.
4. Customize email colors, fonts, spacing, alignment, images, buttons, headings, text, and dividers. Save reusable templates and preview desktop/mobile layouts.
5. Save the draft. Send a test to the configured **sender email address** to inspect the message and first included participant's attachment.
6. Review and confirm the batch, then monitor results. You can pause pending sends, resume, retry confirmed failures, and export reports.

Limits: 2,000 certificates/recipients per campaign, 10 MB per PDF, 50 MB per ZIP input, 100 MB expanded per upload, and 2 MB per CSV. Signed PDFs are attached unchanged. Matching normalizes filenames but never uses approximate/fuzzy name guesses. PDF format checks are not cryptographic signature or malware verification.

## Certificate tagger

Open **Certificate tagger** in the sidebar. Upload an unsigned draft PDF (up to 25 MB) and a CSV with a name column (up to 500 names per batch). Map the name column and optionally the email column. Click the PDF to set the name's baseline; fine-tune its horizontal/vertical percentages, page, font, size, alignment, bold/italic, color, and available width. Automatic fitting reduces long names within that area. You can preview every participant, download one preview PDF, or download all certificates as a ZIP with an exact filename-mapping CSV.

Times Roman, Helvetica, and Courier include bold/italic variants. For another font or characters outside their repertoire, upload a suitable TTF/OTF file; that file's own style is embedded and unsupported characters are reported. Names remain real PDF text. The original PDF pages, vector content, image streams, crop boxes, and rotations are preserved instead of exporting a screenshot. Existing raster images retain their original resolution; this does not enhance a low-resolution source. The rendered preview and download use the same generated PDF bytes.

Template, font, name-list files remain in browser memory until reload. Moving between app sections keeps the tagger session. Nothing is uploaded to a cloud service. ZIP generation can be cancelled and is capped at 250 MB per batch; split large jobs into smaller CSVs. Bring the ZIP and generated participant CSV into a sending campaign when ready. The PDF preview worker, fonts, and resources are bundled locally during `npm install`.

## Verification QR codes (offline, local-only)

Open **Certificate tagger → 4. Verification QR** to stamp each certificate with a scannable QR code:

1. Fill in the training title, date, issuer, and ID prefix. Each participant gets a certificate ID — taken from your CSV's `certificate_id` column when present, otherwise generated as `DICTSDS-YEAR-MONTH-NNN` (issuance year/month from the training date, numbered in list order from 001).
2. Position the QR by dragging it on the preview, set its size, and optionally print the certificate ID beneath it.
3. Export as usual. The ZIP manifest now also carries `certificate_id`, `training_title`, `training_date`, and `issuer` columns.

Each QR holds a human-readable statement (ID, name, training, date, issuer) — no signature line, so it reads cleanly on any phone scanner. To confirm a certificate, match its certificate ID against the official participant list. Everything runs on this computer; nothing is uploaded.

## Data analysis

Open **Data analysis** in the sidebar and upload a participant CSV (up to 5 MB, 5,000 rows). Columns are detected automatically — name, sex/gender (M/F, male/female, lalaki/babae), sector, and email — with manual override when headers are unusual. You get exact headcounts (total, male, female, unspecified sex), a distribution bar, a sector breakdown (PWD, out-of-school youth, students, indigenous people, teachers/educators, senior citizens — click any sector to filter the table), duplicate detection (same first + last name with middle names and Jr/Sr ignored, exact email matching, and exact-row duplicates), per-row quality flags (missing name, invalid email), a searchable/filterable/sortable records table, and a downloadable report CSV with every flag attached. Click any duplicate group to isolate those rows; delete single rows, keep-first per group, or bulk-delete exact/all duplicates.

## Local data and backups

The `.certify` directory is created automatically in this project:

- `workspace.sqlite` — campaigns, recipients, templates, queue, history, and encrypted SMTP settings.
- `certificates/` — uploaded PDFs.
- `credential.key` — automatically generated encryption key for the saved app password.

Data persists across browser reloads and app restarts. There is one shared workspace for whoever uses this computer; no staff roles or application login. The operating system controls access to these files. The password is encrypted with AES-256-GCM and never returned to the browser. Anyone with both the local key and database can decrypt it, so protect backups as you would the app password. This directory is excluded from Git.

To back up, **stop the app first**, then copy the entire `.certify` directory, including the key. Restore the whole directory before restarting. Do not delete or regenerate the key while preserving encrypted settings. You can optionally change the data location using `CERTIFY_DATA_DIR` in `.env.local`; no environment setup is otherwise necessary.

Campaign retention runs hourly while the app is open. Eligible drafts, paused, and completed campaigns are removed after their selected retention period, measured from creation. Sending campaigns remain. Audit actions retain for 365 days. Deleted files are removed from the app directory, not from backups.

## Sending behavior

The local Node server processes a persistent SQLite queue. Atomic claims and unique campaign/recipient jobs prevent normal duplicate sends, including after relaunch. Sending is independent of the browser. Tests count toward the daily limit.

- **Queued:** waiting for the worker or provider allowance.
- **Processing:** a worker has claimed the message.
- **Accepted:** SMTP accepted it; this is not proof of inbox delivery.
- **Failed:** preparation or explicit SMTP rejection failed. Confirmed SMTP 4xx rejections retry up to three attempts with increasing delays. Confirmed failures can be retried manually.
- **Uncertain:** a connection/process stopped without a definitive SMTP result. No automatic resend occurs. Check provider sent-mail records before deliberately creating a resend campaign. Interrupted processing becomes uncertain after five minutes.

Pausing stops new claims; the current email may finish. Delivery/bounce tracking is not implemented. Use only one running application instance for this data directory. The editor is for transactional training-certificate delivery, not consent-based promotional mailing lists.

## Verification

```sh
npm test
npm run build
# With the local app running:
node scripts/local-check.mjs
```

Tests use temporary databases and mocked SMTP transports; they do not send actual emails. They exercise local persistence, encryption, request-origin checks, upload/save behavior, queue claims, retry handling, and the SMTP settings route without a login. The browser check creates fictional campaigns, verifies PDF/ZIP persistence and the enabled SMTP control, and deletes its own test campaigns. Sample CSVs and certificates are in `public/samples/` and use reserved example.com addresses.

This local version is not suitable for Vercel or GitHub Pages: persistent local files and a continuously running worker require a local Node process. GitHub can still hold the source code. No external database or worker subscriptions are used.
