# Kiteezi Recreational Center — Functional Website + Private Admin

This package preserves the public Kiteezi website structure and adds a Supabase-backed booking/admin foundation.

## Public website
- Home, Swimming, Menu, Events, Sports, Booking, About and Contact pages.
- No public Staff/Admin Portal link.
- Booking requests use the configured Supabase REST API.
- Swimming and sports (Basketball/Football) do not require catering selection.
- Other applicable event/group/restaurant bookings show food/drink selection.
- Venue space is described as free for applicable event/group bookings; customers pay for Kiteezi food and drinks and agree that outside catering is not permitted.
- Payment choices: Cash, Airtel Money 4371872, MTN Mobile Money 716644.
- Mobile-money references are stored in booking notes and remain pending until staff verification.

## Private admin
`admin/index.html` is deliberately not linked from the public site and requires Supabase Authentication plus an active row in `profiles`.

The admin includes booking management, payment verification, a POS foundation, inventory movement recording and reporting.

## Important production requirement
This frontend uses the publishable/anon Supabase key. **Database Row Level Security and appropriate grants/policies must be enabled in your existing Supabase project.** The ZIP does not replace or overwrite your existing SQL.

Because the project must work with the SQL you already ran, the booking workflow stores catering/payment details inside the existing `bookings.notes` JSON rather than requiring new booking columns.

## Optional seed
`sql/optional-seeds.sql` is non-destructive and adds Football plus a Basketball/Football sports record if missing. It is safe to run only if those records are not already present.

## Local testing
Serve the folder from a local HTTP server (rather than relying on `file://`) and open the public pages. Example:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080/`.
