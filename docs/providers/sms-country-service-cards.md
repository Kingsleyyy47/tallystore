# SMS country and service cards

The customer page has separate US Numbers and International Numbers sections.
International Numbers has a country selector. Each card uses the complete service
name and country, such as US WhatsApp or Canada WhatsApp. Instagram / Threads and
Instagram retain separate identities. Selection, pricing, checkout and receipts
use the country-qualified service code; changing country clears selection, and an
older catalogue response cannot replace the new country's cards.

Cards show an app icon, Single SMS / Multi SMS, current quantity and one NGN selling
price. The selected card's purchase panel repeats its country, app, SMS mode and
price in a floating rounded checkout dock. The total and action sit side by side,
with a wallet summary and shortfall below. Add Funds is the main action when the
wallet is insufficient; Continue opens confirmation when funded. A dismiss control
clears the selection. Global match/service counters are not shown to customers.
Missing app artwork uses a distinct app initial rather than a generic phone icon.

Quantity comes from the same currently preferred offer as the price, instead of
adding supplier inventories that might share upstream stock. Multi SMS is shown
only when every available fallback explicitly confirms that capability; otherwise
the card promises a single SMS. No supplier name, account balance, API key or
technical response is projected into customer cards.

US offers continue ranking automatically by product delivery reliability, speed
and availability. Only exact matching names and countries share a card. An
unresolved supplier-local ID is excluded from customer cards, rather than exposed
as a supplier-prefixed name or guessed into another country. Paid outcomes remain
pinned: only a confirmed no-charge rejection can advance to another supplier.

International Numbers uses the admin's selected HeroSMS or DaisySim / SMSBus
connection. The initial selection is HeroSMS, whose account currency was confirmed
as USD. Admin > Provider balances & SMS routing contains the selector. Staff can
read the selection; only an active admin can change it. The server records the
actor and checks the current selection again before allocating a number. An
international selection never changes the US automatic ranking policy.

Supplier balance warnings load only on admin/staff management routes. They are
not displayed over customer shopping, even when an admin or staff member browses.

Validation covers actual card rendering, country-scoped offers and variants,
primary stock counts, fresh international selection against a warm cache, SQL
permissions/audit, existing purchase/refund safety, and an isolated browser with
mocked catalogue responses at 393px and desktop widths. The browser checks exercise
the actual SMS surface, rapid country switching, section/history switching,
insufficient funds and suppression of supplier overlays. No paid order is placed.

App artwork is bundled locally to avoid external image requests. Icons are from
[Simple Icons](https://simpleicons.org/) (CC0), with Amazon, LinkedIn and Yahoo
from [Font Awesome Free](https://fontawesome.com/license/free) (CC BY 4.0).
