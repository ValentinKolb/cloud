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

## Article descriptions

| Subject | App | Lists table | Articles table | Article form |
| --- | --- | --- | --- | --- |
| Contributor group | Open | Read `created_by` | Read `related_created_by` through the List relation; create through Form | Submit |
| Responsible group | Open | Read and update `all` | Read and update `all` | Read and submit |

The fixed List relation is authorized again on submission. Supplying another
list UUID in the URL cannot create or reveal an article for an inaccessible
parent.

## Inventory lending

| Subject | Borrower app | Loan desk app | Inventory and availability | Loans | Loan items | Documents and launchers |
| --- | --- | --- | --- | --- | --- | --- |
| Borrower group | Open | None | Read the published catalogue and bounded availability source | Read and update allowed draft fields with `created_by`; create through Form | Read `related_created_by` through Loan | Read allowed runs; execute Finalize and Add item launchers |
| Loan desk group | Open | Open | Read | Read and update `all` | Read and update `all` | Generate/read; execute approval and return launchers |

The Add item and Finalize workflows re-read the loan, validate its state and
period, and reject conflicts. Availability windows are maintained by existing
workflow-owned record changes; the app only reads their bounded GQL result.

The loan agreement and damage invoice templates are allowlisted by each Record
block. Their runs inherit the loan's row scope.
