# Access fixtures for the Golden apps

Grids App definitions reference resources but do not own access bindings.
These matrices are the required authorization fixtures for the proving apps.
Every subject is an ordinary Cloud account or group.

## Certificate requests

| Subject | App | Requests table | Request form and view | Certificate template | Approval launcher |
| --- | --- | --- | --- | --- | --- |
| Requester group | Open | Read `created_by`; create through Form | Submit / read | Read runs for allowed records | None |
| Responsible group | Open | Read and update `all` | Read | Generate and read | Execute |

Comments inherit the request record scope. Requesters cannot infer another
request from comments, counts, documents, or a copied record URL.

## Reimbursements

| Subject | Requester app | Finance app | Requests and expenses | Receipts | Decision launchers |
| --- | --- | --- | --- | --- | --- |
| Requester group | Open | None | Create through Forms; read own records through `created_by` and their Request relation | Upload and read on own expense records | None |
| Finance group | None | Open | Base write for all pending requests and related expenses | Read through the finance app | Execute approve and reject |

Receipt upload uses the published Record field allowlist. It does not grant the
requester access to the Base API, and copied request or expense URLs are denied
by the page ownership query.

## Article descriptions

| Subject | App | Lists table | Articles table | Article form |
| --- | --- | --- | --- | --- |
| Contributor group | Open | Read `created_by` | Read `related_created_by` through the List relation; create through Form | Submit |
| Responsible group | Open | Read and update `all` | Read and update `all` | Read and submit |

The fixed List relation is authorized again on submission. Supplying another
list UUID in the URL cannot create or reveal an article for an inaccessible
parent.

## Built-in Inventory template

| Subject | Borrower app | Loan desk app | Inventory and availability | Loans | Loan items | Documents and launchers |
| --- | --- | --- | --- | --- | --- | --- |
| Borrower group | Open | None | Read the published catalogue | Read `created_by`; create through Form | Read through the loan's allowlisted item relation | Execute the state-scoped cancel launcher |
| Loan desk group | None | Open | Read | Read and update `all` | Read and update `all` | Generate/read; execute approval, agreement, return, and defect launchers |

The request, approval, agreement, cancellation, and return workflows re-read
the loan and reject invalid state transitions. The template's current data
model requests kits on the loan header; it does not duplicate the richer live
Equipment installation's Loan Items reservation model.

The loan agreement and damage invoice templates are allowlisted by each Record
block. Their runs inherit the loan's row scope.
