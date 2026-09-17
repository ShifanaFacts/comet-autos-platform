# External Integrations

Comet Autos does not depend on external providers unless a feature
genuinely needs one. This document tracks every integration boundary from
the V1 build instruction, what's implemented, what's mocked, and exactly
what you (the product owner) need to configure and when.

## Session authentication

| | |
|---|---|
| Purpose | Staff login (email + password) |
| When required | Already required — implemented in Phase 1 |
| Provider | None — self-hosted. Passwords hashed with `bcryptjs`; sessions are random 256-bit tokens, only their SHA-256 hash stored in the `Session` table, delivered via an `httpOnly` cookie. |
| Credentials | None to configure |
| Environment variables | `DATABASE_URL` only (already required for everything) |
| Where configured | `.env` |
| What's implemented | Login, logout, session validation, permission loading — see `src/lib/auth/`. |
| What you must configure | Nothing for V1. If a future phase adds SSO/2FA, that would be a new integration documented here first. |
| Dev/mock behavior | Fully functional locally — no mocking needed, it's the real implementation. |
| Production considerations | Set `NODE_ENV=production` so the session cookie gets `Secure`; serve over HTTPS. |

## Email

| | |
|---|---|
| Purpose | Sending quotations/invoices to customers, notifications |
| When required | When the Estimates/Invoicing phase adds "Send quotation"/"Send invoice" actions |
| Provider options | Any SMTP-compatible provider, or a transactional API (e.g. Resend, SendGrid, AWS SES) |
| Required credentials | API key or SMTP credentials, once a provider is chosen |
| Environment variables | Not yet defined — will be added (e.g. `EMAIL_PROVIDER_API_KEY`) when this phase starts |
| Where configured | `.env` (dev), your hosting platform's env config (prod) |
| What's implemented | Nothing yet. The eventual `NotificationService` (section 39) will define an `EmailNotificationProvider` interface so this can be swapped without touching call sites. |
| What you must configure | Choose a provider and supply an API key when this phase starts — you'll be asked then. |
| Dev/mock behavior | A dev provider that logs to the console instead of sending, so the flow is testable without real credentials. |
| Production considerations | SPF/DKIM/DMARC records for your sending domain, so mail doesn't land in spam. |

## SMS / OTP

| | |
|---|---|
| Purpose | Customer identity verification for secure quotation/invoice links (section 13) |
| When required | When the customer quotation-approval phase is built |
| Provider options | Twilio, AWS SNS, or a UAE-local SMS gateway |
| Required credentials | API key/account SID, once a provider is chosen |
| Environment variables | Not yet defined |
| Where configured | `.env` (dev), hosting platform (prod) |
| What's implemented | Nothing yet. |
| What you must configure | Choose a provider and supply credentials when this phase starts. |
| Dev/mock behavior | A fixed dev OTP (e.g. always `000000`, logged to the console) so the customer-facing flow is fully testable without a real SMS provider — the build instruction explicitly requires this. |
| Production considerations | Cost per SMS in the UAE; consider WhatsApp as a cheaper/higher-open-rate alternative (see below). |

## WhatsApp

| | |
|---|---|
| Purpose | Sending quotations/invoices/notifications via WhatsApp (common customer preference in the UAE) |
| When required | Optional — only if you want WhatsApp alongside/instead of email/SMS |
| Provider options | WhatsApp Business Platform (Meta), or a BSP (e.g. Twilio, 360dialog) |
| Required credentials | Business API access token, phone number ID |
| Environment variables | Not yet defined |
| Where configured | `.env` (dev), hosting platform (prod) |
| What's implemented | Nothing yet — `NotificationService`'s `WhatsAppNotificationProvider` interface (section 39) will make this a drop-in addition. |
| What you must configure | Choose a provider and complete WhatsApp Business verification when you want this. |
| Dev/mock behavior | Console-logging dev provider, same pattern as email. |
| Production considerations | Meta's business verification process takes time — start it early if wanted. |

## Online payments

| | |
|---|---|
| Purpose | Customers paying invoices online |
| When required | Not required for V1 per the build instruction — the integration boundary should exist, but no payment gateway is wired up |
| Provider options | Stripe, Telr, PayTabs, Network International (all common in the UAE) |
| Required credentials | API keys, once a provider is chosen |
| Environment variables | Not yet defined |
| Where configured | `.env` (dev), hosting platform (prod) |
| What's implemented | Nothing. Invoices/payments are recorded manually by staff (cash/card/bank transfer/cheque) in V1. |
| What you must configure | Nothing until you decide to add online payment. |
| Dev/mock behavior | N/A |
| Production considerations | PCI compliance is the provider's responsibility if you use a hosted checkout (recommended) rather than handling card data directly. |

## Cloud file/object storage

| | |
|---|---|
| Purpose | Storing uploaded photos/documents (inspection photos, invoice PDFs, employee documents — the `Document` table already stores metadata + a `storageKey` pointer) |
| When required | When the Inspection phase adds photo upload, or PDF generation needs a place to persist generated files |
| Provider options | AWS S3, Cloudflare R2, Supabase Storage, Vercel Blob |
| Required credentials | Access key/secret or API token, bucket name |
| Environment variables | Not yet defined |
| Where configured | `.env` (dev), hosting platform (prod) |
| What's implemented | Nothing yet — the `Document` model (metadata only) already exists in the schema, ready for this. |
| What you must configure | Choose a provider and create a bucket when this phase starts. |
| Dev/mock behavior | Local filesystem storage under a gitignored directory, for local development only. |
| Production considerations | Signed URLs with short expiry for any customer-facing document access, never public buckets. |

## UAE e-invoicing

| | |
|---|---|
| Purpose | Future compliance with UAE mandatory e-invoicing |
| When required | Not required for V1 — flagged as future scope only |
| Provider options | To be determined once the UAE's Accredited Service Provider framework is finalized for your business size/category |
| Required credentials | N/A yet |
| Environment variables | N/A yet |
| Where configured | N/A yet |
| What's implemented | Nothing — the `Invoice` model's structure (seller/customer snapshot fields, `TAX_INVOICE`/`PROFORMA` types) is compatible with adding this later without a schema rewrite. |
| What you must configure | Nothing until UAE e-invoicing becomes mandatory for your business and a provider is selected. |
| Dev/mock behavior | N/A |
| Production considerations | Revisit when the FTA publishes final implementation timelines for your business category. |
