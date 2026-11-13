# Sai Ping — Project Document

**Last updated:** 13 November 2026
**Maintained by:** Khun Maung Aye (Scrum Master)

This document is the team's single source of truth for what Sai Ping is, who
is building it, how the team works, and where the project currently stands.
For how to run and build the code, see [README.md](../README.md). For
coding rules and architecture, see [AGENTS.md](../AGENTS.md).

---

## 1. Project Overview

**Sai Ping** is a home-cleaning booking website for Bangkok, built as a
student Agile Software Development group project. Customers book a cleaning
on a day a cleaner is available; cleaners accept open jobs and mark them
complete; customers rate and review the cleaner afterwards. A single admin
account oversees bookings, cleaners, customers and reviews.

**Why it exists:** to demonstrate a full Agile delivery cycle — a backlog
driven by user stories, sprint-based delivery, peer-reviewed pull requests,
and a working, deployable product — while building something genuinely
usable.

## 2. Goals & Objectives

- Deliver a working three-sided marketplace (customer / cleaner / admin) for
  home cleaning bookings in Bangkok.
- Practise real Agile ceremonies: a prioritised backlog, sprint planning,
  Definition of Done, retrospectives and continuous improvement actions.
- Keep every change traceable to a user story or a logged bug, reviewed by a
  teammate before it reaches `main`.
- Explore AI-assisted features (cleaner recommendation, auto-scheduling) as
  stretch goals once the core booking flow is solid.

## 3. Scope

**In scope**
- Customer booking (one-time and recurring), cancellation, rescheduling, and
  rating/review.
- Cleaner job acceptance, availability management, and job completion.
- Admin oversight: all bookings, cleaner ratings, account suspension.
- Role-based authentication with a single sign-in flow.

**Out of scope (for now)**
- Real payments — prices are shown but nothing is actually charged.
- Real notifications (email/SMS) — all confirmations are shown in-app only.
- A native mobile app — the site is responsive but web-only.
- Multiple admins or multiple cleaning companies on one deployment.

## 4. Team & Roles

| Name | Role | Trello | GitHub |
| --- | --- | --- | --- |
| Khun Maung Aye | Scrum Master / Developer | Khun Maung Aye | `KhunMaungAye` |
| Thida Khaing | Product Owner / Developer | maybhonekhin | `Thida-Khaing-may` |
| Kaung Khant Htoo | Developer | kaungkhant htoo | `kxkhantx` |

The Product Owner (Thida) prioritises and assigns backlog items. The Scrum
Master (Khun) facilitates the board, branch protection and process health.
All three review one another's pull requests.

## 5. Tools & Workflow

- **Board:** Trello (story cards, acceptance criteria, Definition of Done,
  sprint burndown and the team's retrospective/improvement actions).
- **Code:** GitHub, repository `KhunMaungAye/Sai_Ping`.
- **Process:**
  1. Pick up a story or bug card from the board.
  2. Branch from an up-to-date `main`.
  3. Build it against the card's acceptance criteria, with tests.
  4. Open a pull request into `main` describing how each AC is met and how
     to test it by hand.
  5. A teammate reviews and approves before it merges — **nobody merges
     their own PR**. `main` is protected: 1 approving review is required
     before the merge button unlocks.
  6. Move the card to **In Review**, then **Done** once merged and checked
     off against the Definition of Done.

## 6. Definition of Done

A story only moves to **Done** when all five hold:

1. **Acceptance criteria:** every AC on the card is met and verified.
2. **Testing:** the happy path, edge cases and error conditions are tested
   and pass.
3. **Bug-free:** no major blocking bugs or unhandled errors remain.
4. **Code review:** the code is committed, merged, and peer-reviewed by
   another team member.
5. **Usable UI:** the interface is clear, responsive (desktop and mobile)
   and usable.

## 7. Tech Stack (summary)

Next.js 16 (App Router) · React 19 · TypeScript · SQLite via `node:sqlite` ·
bcryptjs for passwords. No ORM, no external services, no paid
infrastructure. Full architecture notes live in [AGENTS.md](../AGENTS.md).

## 8. Timeline

| Sprint | Rough dates | Focus |
| --- | --- | --- |
| Sprint 1–2 | Late Oct 2026 | Core booking, auth, recurring cleanings, special instructions |
| Sprint 3 | Early Nov 2026 | AI-assisted cleaner recommendation, admin booking filters, cleaner ratings |
| Sprint 4 | Mid Nov 2026 | Cancel/edit bookings, cleaner job views, admin reassignment, review tags, travel-time rules, bug fixes |
| Sprint 5 (planned) | Late Nov 2026 | Single sign-in + cleaner applications, contact inbox, single-cleaner weekly plans, single-visit reschedule |

There is no fixed calendar deadline beyond the course's own schedule; the
backlog is re-groomed each sprint based on what the Product Owner prioritises.

## 9. Current Status (as of 13 Nov 2026)

- **Delivered and merged:** booking, recurring cleanings, role-based auth,
  special instructions, pause/skip, cleaner rating & reviews, AI-recommended
  cleaner, admin booking filters and cleaner ratings, cancel/edit a booking,
  cleaner job and schedule views, admin reassignment, review tags,
  travel-time rule, and several bug fixes.
- **Open for review:** see the GitHub pull request list — every merge needs
  a teammate's approval per the Definition of Done.
- **Not yet started:** single sign-in with a cleaner-application flow,
  contact-form inbox, weekly plans locked to one cleaner, and single-visit
  rescheduling for recurring plans.

## 10. Risks & Open Issues

- **Process risk:** `main`'s required-review setting has been found
  disabled more than once, letting pull requests merge without a real peer
  review. The Scrum Master checks this periodically; restoring it needs
  the Product Owner's agreement first.
- **No real payments or notifications:** acceptable for a course project,
  but would block a real launch.
- **Single admin account:** fine for the current scope; would need
  multi-admin support to operate at a larger scale.

## 11. Budget & Resources

This is a student project with no monetary budget. The only resource is the
team's own time, tracked in story points per sprint rather than cost.

## 12. Revision History

| Date | Change |
| --- | --- |
| 2026-11-13 | First version of this document. |
