# Agent Note: Semantic phases for composer-chain election

Status: implemented

English | [中文](2026-08-08-semantic-composer-chain-phases.zh.md)

## Problem

The browser's `conversation.composer` chain ordered every candidate by one global numeric `priority`, then elected the first selector returning a match. Question used the default priority `0`, approval used `1`, and the one-shot or unavailable-parent read-only subagent composer used `-10`. A selected one-shot history could therefore show the read-only explanation while an answerable question or approval was pending underneath it.

The defect was not one incorrect number. The chain used the same scalar for two different decisions: whether a candidate resolves an existing interaction or restricts starting new work, and the local preference between candidates of the same semantic kind. Any numeric repair preserves that hidden coupling and lets a later registrant recreate the bug.

## Decision

A chain declaration may define an ordered tuple of domain-owned phases. `conversation.composer` declares `['interaction', 'restriction']`; every registration on that phased chain must name one phase, and its numeric `priority` orders entries only within that phase. `SlotCore` sorts by declared phase index, then local priority, then stable registration order. Registration fails immediately when a phased chain entry omits its phase or names one outside the declaration. Unphased chains retain their previous numeric behavior and reject a `phase` field.

Question and approval register in `interaction`, retaining their within-phase order of question (default priority) before approval (`priority: 1`). `SubagentReadOnlyComposer` registers in `restriction` with the ordinary default local priority. The domain rule is precise: an interaction resolves a live Host wait that already exists; a restriction prevents the user from initiating work through the ordinary composer. Resolving an existing wait is not a new follow-up to the one-shot child, so the interaction phase goes first. Once the wait resolves, the chain re-elects and the read-only restriction becomes visible again.

The phase vocabulary belongs to the declaring slot, not to the slot framework globally. `SlotMap` carries the exact phase tuple for compile-time registration, and the runtime `SlotSpec` repeats that tuple as the sorting authority. Other chains acquire no composer terminology and need no migration unless they deliberately declare phases.

This decision extends the [Web subagent conversation](../feature/2026-07-27-web-subagent-conversations.md), [Web permission and approval](../feature/2026-07-23-web-permission-and-approval.md), and [plan-review presentation](../feature/2026-07-30-plan-review-presentation-intent.md) contracts; it supersedes none of them. The [runtime-owned child guard](../bug-fix/2026-08-01-ask-user-delegated-caller-guard.md) remains the authority that prevents new child-owned human waits.

## Alternatives considered

**Move the read-only priority after question and approval.** This is the smallest tactical fix, but it leaves semantic dominance encoded as undocumented number spacing and makes the next composer kind guess at the same global scale.

**Make the read-only selector decline whenever `interactions` is non-empty.** This fixes the current pair but makes a restriction plugin understand every actionable domain and duplicates election policy across selectors. A new interaction kind would require edits in unrelated restrictions.

**Rely only on the runtime child guard.** The guard fixes new model calls but cannot define browser ordering for already-pending waits, rolling-version overlap, or other interaction kinds such as approval. Runtime authority and presentation election are separate invariants.

**Render all matching takeovers as a stack.** The composer has one action seat. Stacking question, approval, and read-only surfaces makes keyboard focus and answer ownership ambiguous instead of selecting one current action.

## Consequences

Semantic dominance is named on the declaring slot and enforced at registration, so a later composer cannot recreate the one-shot-over-pending-interaction bug by picking a more negative global priority. Local priority remains useful for same-phase ties (question before approval). Unphased chains keep their previous API.

`SlotCore` unit tests pin phase order over arbitrary local priorities, within-phase priority and registration order, fail-loud unknown or omitted phases, and unchanged unphased sort. Plugin registration tests assert question/`interaction` and read-only/`restriction` phase stamps. Assembled composer election scenarios (pending interaction over read-only, resolution back to read-only, InputBar fallback) and a keyless Web snapshot of that path remain coverage to land with the presentation harness; election itself stays a pure function of current owner props and current registrations, so dispose, HMR re-registration, and reconnect replay cannot leave a stale elected phase.

The change modifies no model-visible tool definition, system-prompt section, request routing, or session event. Browser election therefore has no token cost and no KV-cache invalidation.
