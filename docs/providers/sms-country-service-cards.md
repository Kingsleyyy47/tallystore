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

All US and international offers use the same per-card automatic selection: exact
service/country matches only, with enabled provider, stock, verified USD balance
sufficient for that specific offer, and the cheapest eligible price first.
Delivery history breaks equal-price ties; recent stock/unknown failures impose a
short availability circuit. Unresolved supplier-local IDs remain excluded.
The former manual international supplier choice is retained only in audit history
and does not restrict automatic matching.

Selling price is the supplier cost converted to NGN (rounded up to one naira) plus
exactly ₦700 for US, ₦600 for Canada, or ₦500 for another country. Old per-product
price overrides, percentage rules and nearest-₦10 rounding cannot override these
SMS fees. Existing visibility/favorite controls remain available. Admin and staff
product rows show the selected automatic provider and the exact markup.

Balance reads share the existing one-minute cache and call only SMS suppliers for
routing. Each allocation refreshes its selected provider's balance before sending.
An account with unknown/denied balance or insufficient funds is excluded. A card
with no funded route stays visible but unavailable; supplier stock alone must not
be advertised as purchasable availability. The approved supplier cost cap preserves
the markup; a more expensive new quote must be confirmed rather than silently
spending the fee. Accepted or uncertain paid results never initiate another paid
request.

PocketFi, ErcasPay and Anthropic do not appear in the provider balance panel, and
that panel does not call their balance endpoints.

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
