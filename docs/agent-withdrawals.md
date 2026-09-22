# Agent withdrawal review

Open **Accounts → Review agent withdrawals**. Admin and Super Admin roles can review requests through the authenticated staff API.

Withdrawal requests require at least ₹3,000 in available commission, after previous payouts and pending requests. Approval reserves the existing request; it does not mark a bank transfer as paid. Staff must verify identity and earnings, re-enter the registered bank account, and add a review note. Recording payment requires prior approval and a bank transfer reference. Rejection requires a reason.

The agent/investor Flutter web app loads withdrawal history from `/v1/agent/withdrawals` and submits requests there. The console uses `/v1/staff/agent-withdrawals` and its `/:id/resolve` endpoint.

Deployment prerequisite: the shared backend withdrawal endpoints and database migration `0059_agent_withdrawal_review.sql` must be deployed before these screens can operate. The frontend does not simulate success when that backend is unavailable. No production migration or deployment was performed as part of the frontend change.
