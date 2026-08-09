# Pointer local-check profile v1

**Pointer** was the planned agent-facing local-check consumer of the genome: a client that runs
deterministic design checks offline against an approved snapshot, without model inference. It
never shipped. This document describes the projection `@uidna/store` publishes for it, which is
implemented and tested here.

`@uidna/store` publishes `getPointerLocalCheckProfile`, a named projection of an approved immutable genome for Pointer's deterministic local checks. The response carries the schema/profile/repository/DNA versions plus a SHA-256 digest over canonical bytes. Draft and in-review snapshots never project, and pinned reads reproduce the same bytes.

Color tokens and observed scales retain their approved UI-DNA paths and fact provenance. The WCAG target-size and contrast entries are explicitly marked `policy_default`; they are not represented as team preferences. Component hints stay empty until the canonical genome owns a stable rendered component signature, so Pointer self-skips that family rather than guessing from display metadata.

The frozen producer fixture is `packages/store/test/fixtures/pointer-local-check-profile.v1.json`. Consumers must validate the version, repository, DNA version, digest, and full shape before citing any rule from the profile.
