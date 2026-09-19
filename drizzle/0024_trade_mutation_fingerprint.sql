-- Create idempotency that checks what was said, not only which key was used.
--
-- `mutation_key` alone let a request with the same key but different content
-- (a second tab, an edited retry, the other recording mode) be answered with the
-- first Trade as though it had just been saved. `mutation_fingerprint` stores a
-- SHA-256 of the normalized create request; a replay whose fingerprint differs is
-- refused as a replay conflict. Additive and nullable: rows created before this
-- migration keep NULL and keep their earlier replay behaviour.
ALTER TABLE "trades" ADD COLUMN "mutation_fingerprint" text;
