# TradeChemist — Add Trade Product Contract v1

> **Status: Approved (v1, 2026-09-14).** This document is the product source of truth for the
> TradeChemist Add Trade domain: At Entry, After Trade, Partial / Final Close, Review, System
> Assessment, and the related Strategy, Psychology and Discipline semantics. Review decisions 1–11,
> final decisions 12–18, closing decisions 19–21, analytics decisions 22–23 and UX boundary
> decisions 24–37, pre-design decisions 38–40, Review / System Assessment decisions 41–49, the
> recording-lifecycle decisions 50–51 (2026-09-22) and the Actual Risk at Entry amendment 52,
> stage-placement amendment 53 and Planned Risk amendment 54 (2026-09-23), and the capture-order,
> Actual Risk, closing-model and result-authority amendments 55–58 (2026-09-24/25) are recorded in the
> [Decision log](#decision-log). How Review and System Assessment apply this
> contract is defined in [Review & System Assessment](review-system-assessment.md) (approved v1,
> 2026-09-20), which elaborates §14–§22, §25 and §28; decisions 41–49 amend §8, §18, §21 and §25 in
> place.
>
> **Authority:** where [`docs/UX_RULES.md`](../UX_RULES.md), `CLAUDE.md`, canonical technical
> documentation (such as `docs/calculation-spec.md`, `docs/data-dictionary.md` or
> `docs/product-spec.md`), the visual system or a historical Phase document disagrees with this
> contract about Add Trade behaviour or semantics, this contract wins. UX Rules define the
> interaction behaviour that applies this contract. See [`README.md`](README.md) for the
> documentation precedence order.
>
> **Implementation status:** approved target behaviour, not yet fully implemented. Current
> production behaviour that differs is pending migration and must not be read as approved product
> behaviour. Implemented so far: At Entry (migrations 0021–0022) and After Trade / Save Closed
> Trade (migration 0023). Record Exit, Partial / Final Close, Review and System Assessment remain
> pending.

## 1. Product model

TradeChemist มีเส้นทางบันทึก Trade หลักสองแบบ:

**At Entry**
ใช้เมื่อ Trade ยังเปิดอยู่ ผู้ใช้บันทึกข้อมูลที่รู้และสังเกตได้ในช่วงเข้า Trade

**After Trade**
ใช้เมื่อ Trade ปิดไปแล้ว ผู้ใช้บันทึกย้อนหลังเท่าที่จำได้หรือทราบ

ทั้งสองเส้นทางสร้าง Trade model เดียวกัน ต่างกันที่ timing, completeness และ provenance ของข้อมูล

ไม่มี Plan mode หรือ Price-result mode แยกต่างหาก

## Recording lifecycle

**Added 2026-09-22 (decision 50).** Recording a Trade follows **one lifecycle**, not two unrelated
forms. The lifecycle groups the semantics this contract already defines into six canonical
stages; it adds no new state, value, result or requirement, and it changes none:

1. **Trade Details** — Account, Symbol, Direction, Entry time (§6, §13).
2. **Plan & Risk** — the Planned Risk decision (decision 54) and, when it is Defined, the amount
   defined as 1R for the Trade — its one Risk; Target and Exit Plan (§5); and price levels as
   context only (§3).
3. **Setup & Checklist** — Strategy, Setup and setup conditions (§7–§8).
4. **Entry Context & Evidence** — Confidence and Entry Emotion (§9), and optional entry context:
   trade idea / reason, timeframe, session, chart and the Trade's notes (§6). It asks no risk
   figure (decision 56).
5. **Exit & Result (Trader Result)** — what the trader actually did: exit events and
   exit-history completeness (§10–§11), final exit time, Final Net P&L and Trader Outcome
   (§11–§12), and Trader R (Final Net P&L ÷ Risk at Entry) only when a Defined Risk exists. A Part
   exit stays within this stage and asks no whole-Trade Final Net P&L or Trader Outcome.
6. **After Trade** — two sections, in this order (decision 55). **System Result**: the factual
   Plan Outcome — what the original plan would have produced. **After-Trade Context**:
   capture-only context about the close, such as Post-Trade Emotion (§9), an after-trade note and
   after-trade evidence. It is reached only when the Trade becomes Closed, and every answer in it
   is optional.

The step labels are the same in every flow (decision 55): **Trade**, **Risk & target**,
**Strategy & setup**, **Entry context**, **Trader result**, **After trade**.

**One Risk (decision 56).** A Trade has one canonical Risk: the amount the trader defines as 1R
in Plan & Risk. Trader R = Final Net P&L ÷ Risk and System R = System Result ÷ Risk; with No
Defined Risk there is no Trader R, System R or Planned RR, and Risk is never derived from Entry,
SL or size. **Actual Risk is retired from capture:** no flow asks it, and no Save writes it. A
Trade that recorded one before the retirement keeps it as history — shown where it was recorded,
never backfilled or reinterpreted, and never an input to Trader R, System R, Planned RR or
canonical analytics.

Three task flows use the lifecycle. They are the recording routes of §1 plus the close of §11:

- **Record Open Trade** (At Entry): stages 1 → 2 → 3 → 4, then Save Open Trade (§6).
- **Close Existing Open Trade** (Record Exit / Final Close of an existing Trade): stages 5 → 6,
  reaching Closed only through the explicit confirmation of §11. A Part exit ends within stage 5
  (Partially Closed); stage 6 follows only when All Remaining makes the Trade Closed. Stages 1–4
  are the Trade's existing, preserved context and are not re-entered.
- **Record Closed Trade** (After Trade): every stage, in canonical order 1 → 2 → 3 → 4 → 5 → 6
  (decision 55). Stages 1–4 are the same components, semantics, labels and order Record Open
  Trade uses; only the recording mode differs.

The canonical stage decides **what a question means and where it belongs**; a task flow may
**present** stages in a different order. Semantics, requirements, defaults and provenance stay
those of this contract and of the recording mode, whatever the order: Save Open Trade and Save
Closed Trade keep their §6 and §13 minimums; At Entry keeps its visible Strategy-default Exit Plan
inheritance and After Trade never inherits (§5); Money stays the result authority and Price stays
context (§3); setup conditions stay multi-state (§8).

**Review and System Assessment are not a stage.** They stay post-save, for Closed Trades only, and
entered only by the trader's choice (§14, §20–§21). Stage 6's System Result is not System
Assessment: it records a factual Plan Outcome, and never writes, confirms or implies a System
Assessment (decision 55).

Interaction rules for the lifecycle and the task flows are in
[UX Rules §20](../UX_RULES.md#20-recording-lifecycle-and-task-flows).

---

# 2. Core principle

TradeChemist ต้อง:

**Capture simple → preserve truth → analyze deeply later**

ระบบต้องไม่สร้างความแน่นอนจากข้อมูลที่ผู้ใช้ไม่ได้ให้

ดังนั้น:

Unanswered ≠ Unknown ≠ None ≠ Zero ≠ Negative answer

และข้อมูลที่ผู้ใช้กรอกแล้วต้องมี persistence behavior ที่ชัดเจน

---

# 3. Money and Price

## Money

Money เป็น source of truth สำหรับผลลัพธ์ทางการเงิน

ใช้กับ:

- Final Net P&L
- Risk
- Actual R
- System R
- monetary analytics

Money เป็น input ที่แนะนำสำหรับ System Result แต่ System R อาจมาจาก direct R input ได้ (ดู §15)

## Price

Price เป็น optional execution context เท่านั้น เช่น:

- Entry price
- SL
- TP
- Exit price
- Partial exit prices

Price ไม่ใช้คำนวณ:

- Final P&L
- Actual R
- System R
- Win / Loss / BE

ไม่มี Money/Price result-basis switch

## Price consistency

Price ที่ขัดกันเชิง semantic แต่เป็นไปได้ เช่น Long trade ที่ SL อยู่เหนือ Entry เป็น data-quality notice ที่ไม่ block การ Save ไม่ใช่ error

Price input ที่ malformed (parse เป็นราคาไม่ได้) ยังเป็น error ได้

Contextual display ที่ derive จาก Price เช่น distance หรือ pips อาจถูกสำรวจภายหลัง แต่ Price ห้ามเป็น calculation authority ของ canonical P&L, Actual R, System R หรือ System Result

---

# 4. Risk

**Risk at Entry** (Intended Risk)
ความเสี่ยงที่ trader ตั้งใจรับตอนเข้า Trade และเป็น primary **1R baseline**

Primary comparison metrics ทั้งสองใช้ denominator เดียวกัน:

- `System R = System Result / Risk at Entry`
- `Actual R = Actual Result / Risk at Entry`

ถ้า Risk at Entry unknown: Actual R และ System R ที่ต้อง derive จาก Money เป็น unavailable แม้จะทราบ Actual Risk (legacy 1R baseline ให้ legacy R สำหรับ historical record เท่านั้น ไม่ใช่ canonical R — ดู §28)

**Actual Risk** — เลิกใช้ในการบันทึกแล้ว 2026-09-25 (decision 56): Actual Risk ไม่ถูกถามใน flow การบันทึกอีกต่อไป ทั้ง Record Open และ Record Closed — Risk ใน Step 2 (Risk & target) คือจำนวนที่ trader กำหนดเป็น 1R ของเทรด และเป็นฐานเดียวของ Trader R และ System R ข้อความด้านล่างอธิบายความหมายของข้อมูลที่ **บันทึกไว้ก่อนหน้า** ซึ่งยังเก็บไว้ครบ ห้าม backfill ห้าม reinterpret และห้ามนำมาใช้คำนวณ R, RR หรือ canonical analytics ใหม่

_(ประวัติ)_ ความเสี่ยงทางการเงินจริงของ position เมื่อ execution ทำให้ต่างจาก Risk at Entry

Actual Risk **ไม่** เปลี่ยนนิยามของ Actual R ใช้สำหรับ Risk Discipline / Risk Deviation analytics

UX ต้องไม่บังคับให้กรอกสองค่าทุกครั้ง

กรณีทั่วไปควรเรียบง่าย เช่น:

Risk at Entry = $50

แล้วเปิด progressive action เช่น:

Actual risk differed

เพื่อบันทึก Actual Risk เฉพาะเมื่อจำเป็น

## Planned Risk (การตัดสินใจเรื่องความเสี่ยง)

**แก้ไข 2026-09-23 (decision 54):** Planned Risk มี **สามสถานะ** เท่านั้น

- **Unanswered** (ค่าเริ่มต้น) — ยังไม่ได้ตัดสินใจ ห้ามตีความเป็น No Defined Risk
- **Defined Risk** — มี planned 1R เป็นจำนวนเงิน และจำนวนนั้นต้อง > 0
- **No Defined Risk** — คำตอบที่ระบุชัดว่าไม่ได้กำหนด 1R ไม่มีจำนวนเงิน และไม่มี R / RR ให้เทียบตลอดไป

Record Open **ต้องมีการตัดสินใจ** (Defined + จำนวน หรือ No Defined Risk) แต่ **ไม่บังคับให้ต้องมีจำนวนเงิน** — ห้ามบังคับให้ trader สมมติตัวเลขขึ้นมา After Trade ยังคงปล่อยให้ Unanswered ได้สำหรับ Trade ย้อนหลัง

Trade ที่เป็น No Defined Risk: ห้ามสร้าง Actual R / Trader R / RR ใด ๆ และไม่ถาม Actual Risk (ไม่มีแผนให้เทียบ — ดู §4 Actual Risk)

ห้าม infer สถานะนี้จาก SL price — SL price เป็น Price Context บอกว่า stop จะอยู่ตรงไหน ไม่ได้บอกว่ามีการกำหนด 1R หรือไม่ (§2, §3, §8)

_Stop Method (decision 53) ถูกถอดออกจากการบันทึกแล้ว (decision 54): ไม่มี UI ไม่มีการเขียนค่าใหม่ ค่าที่เคยบันทึกไว้ยังคงอยู่เป็นข้อมูลประวัติเท่านั้น ห้าม infer อะไรจากค่าเหล่านั้น_

## Actual Risk at Entry

**เลิกใช้ในการบันทึกแล้ว 2026-09-25 (decision 56):** Actual Risk ไม่ถูกถามใน flow การบันทึกอีกต่อไป ทั้ง Record Open และ Record Closed — Risk ใน Step 2 (Risk & target) คือจำนวนที่ trader กำหนดเป็น 1R ของเทรด และเป็นฐานเดียวของ Trader R และ System R ข้อความด้านล่างอธิบายความหมายของข้อมูลที่ **บันทึกไว้ก่อนหน้า** ซึ่งยังเก็บไว้ครบ ห้าม backfill ห้าม reinterpret และห้ามนำมาใช้คำนวณ R, RR หรือ canonical analytics ใหม่

**แก้ไข 2026-09-23 (decision 53):** Actual Risk ถูกถามใน **Entry Context & Evidence (stage 4)** ไม่ใช่ Plan & Risk — เป็น execution fact ของตอนเข้า ไม่ใช่ส่วนหนึ่งของแผน ความหมายและสถานะทุกอย่างคงเดิม

**แก้ไข 2026-09-23 (decision 52):** Actual Risk at Entry เริ่มต้นเป็น **Unanswered**

การไม่ตอบ ไม่ใช่การยืนยันว่าตรง — ห้าม infer Matched จากการที่ไม่มีคำตอบ Different

trader ต้องระบุอย่าง explicit ว่า:

- **Matched risk at entry** → Matched
- **Different** → บันทึก Actual Risk (ถ้าไม่กรอกจำนวน เก็บเป็น **Different** และ **amount unknown** ห้าม revert เป็น Matched เงียบ ๆ)

Unanswered ไม่ขัดขวาง primary System-vs-Actual comparison เพราะ Actual R ใช้ Risk at Entry เป็น 1R baseline ร่วม (§4, §17)

_เดิม (v1, 2026-09-14 ถึง 2026-09-22): การไม่เปิด `Actual risk differed` หมายถึง trader ยืนยันว่า actual risk ตรงกับ Risk at Entry ที่บันทึก โดย interaction ต้องสื่อความหมายนี้อย่างซื่อสัตย์ ห้ามเป็น hidden server inference — Trade ที่บันทึกไว้ภายใต้ข้อตกลงเดิมยังคงเป็น historical observation ที่ valid ห้าม backfill หรือ reinterpret (decision 52)_

## Planned RR (decision 54)

- **Fixed Target + Defined Risk** → ทราบ Planned RR
- **No Fixed Target + Defined Risk + Exit Plan** → ยังไม่ทราบ Planned RR ตอนเข้า แต่ยังใช้ประเมิน System-vs-Trader แบบอิงกฎได้ภายหลัง
- **No Fixed Target โดยไม่มี Exit Plan ที่ใช้ได้** → ไม่มี planned System result ให้ resolve จากโมเดลปัจจุบัน
- **No Defined Risk** → ไม่มีค่า R / RR ไม่ว่าจะตั้ง Target แบบใด

## Known Risk at Entry

Risk at Entry ที่ทราบค่าต้องมากกว่าศูนย์

ศูนย์ไม่ใช่ตัวแทนของ risk ที่ unknown หรือไม่ได้บันทึก

## Actual Risk in After Trade

**เลิกใช้ในการบันทึกแล้ว 2026-09-25 (decision 56):** Actual Risk ไม่ถูกถามใน flow การบันทึกอีกต่อไป ทั้ง Record Open และ Record Closed — Risk ใน Step 2 (Risk & target) คือจำนวนที่ trader กำหนดเป็น 1R ของเทรด และเป็นฐานเดียวของ Trader R และ System R ข้อความด้านล่างอธิบายความหมายของข้อมูลที่ **บันทึกไว้ก่อนหน้า** ซึ่งยังเก็บไว้ครบ ห้าม backfill ห้าม reinterpret และห้ามนำมาใช้คำนวณ R, RR หรือ canonical analytics ใหม่

After Trade ห้ามสมมติเงียบ ๆ ว่า Actual Risk ตรงกับ Risk at Entry

Actual Risk เริ่มต้นเป็น **Unanswered** จนกว่า trader จะระบุอย่าง explicit ว่า:

- Matched Risk at Entry
- Different → บันทึก Actual Risk
- Don't know → Actual Risk เป็น Unknown

เพราะ primary Actual R ใช้ Risk at Entry เป็น 1R baseline ร่วม Actual Risk ที่เป็น Unanswered หรือ Unknown จึงไม่ขัดขวาง primary System-vs-Actual comparison

Actual Risk ใช้สำหรับ Risk Discipline / Risk Deviation

Risk deviation เป็นข้อมูลสำหรับ Risk Discipline analytics แต่ไม่ควรทำให้ Add Trade ซับซ้อน

Report หลักยังคงเน้น System R vs Actual R ส่วน Risk Deviation เป็น secondary insight

---

# 5. Target and Exit Plan

Target และ Exit Plan เป็นคนละ concept

**Target = objective**

**Exit Plan = rule**

ผู้ใช้อาจมี:

- Fixed Target + Exit Plan
- Fixed Target โดยไม่มี Exit Plan เพิ่ม
- No Fixed Target + Exit Plan
- No Fixed Target + No Defined Exit Rule
- Target/Exit Plan ยังไม่ได้บันทึก

`No Fixed Target` ไม่ได้หมายถึง `No Exit Plan`

## Target states

- Unanswered
- Fixed Target
- No Fixed Target

**Fixed Target** คือ objective ที่กำหนดไว้ล่วงหน้า ไม่จำเป็นต้องมีจำนวนเงิน อาจประกอบด้วย:

- monetary Target Profit
- TP price
- หรือทั้งสองอย่าง

การเลือก Fixed Target ต้องมี target representation อย่างน้อยหนึ่งอย่าง: monetary Target Profit หรือ TP price

Fixed Target ที่ไม่มีทั้งสองอย่างไม่ใช่ completed target state ที่ valid

ถ้า trader เลือก `Fixed Target` อย่าง explicit แต่ไม่มีทั้ง Target Profit และ TP price การ Save ถูก block ด้วย field-level validation error

ห้ามแปลง state เป็น Unanswered หรือ No Fixed Target เงียบ ๆ

objective แบบ dynamic หรือไม่ fixed (เช่น ถือจนกว่า trend-line break) อยู่ใน Exit Plan ไม่ใช่ Target

TP price เป็น execution/context data เท่านั้น และห้ามใช้คำนวณ System Result

ถ้าบันทึกไว้แค่ TP price และภายหลัง trader ยืนยันว่า target ถูกชน System Assessment ต้องขอ System Result เป็น Money หรือ R จาก trader

## Exit Plan states

- Not recorded
- Saved Exit Plan
- Customized for this trade
- No Defined Exit Rule

Exit Plan สามารถมาจาก library และ Strategy default ได้

## Strategy default ใน At Entry

At Entry สามารถ inherit default Exit Plan ของ Strategy ที่เลือกไว้โดยอัตโนมัติ ตราบใดที่ trader ยังไม่ได้เลือก Exit Plan state อื่นอย่าง explicit

การ inherit ต้อง visible เช่น `From Strategy: <name>`

trader ต้องสามารถ:

- customize
- replace ด้วย Exit Plan อื่น
- ปฏิเสธ inherited plan
- เลือก No Defined Exit Rule

**เมื่อ trader override inherited state อย่าง explicit แล้ว การ inherit จะถูก suppress สำหรับ Trade นั้นจนกว่าจะถูก restore อย่าง explicit**

Strategy default เดิมห้ามปรากฏกลับมาเองทันทีหลังถูกปฏิเสธ การ restore ต้องเป็น explicit action เช่น `Use strategy default`

UX ควรหลีกเลี่ยง label `Clear` แบบกว้าง ๆ เพราะความหมายกำกวม

## Strategy default ใน After Trade

After Trade ห้าม apply Strategy default หรือ Exit Plan default ของปัจจุบันให้ historical trade โดยอัตโนมัติ trader เลือก saved rule ปัจจุบันเองได้ แต่ต้องถูกบันทึกว่า recalled/selected ระหว่าง reconstruction

เมื่อ Trade ใช้ Exit Plan ระบบต้องเก็บ snapshot ของ rule ณ เวลานั้น ไม่ใช่ pointer ที่เปลี่ยนตาม library ในอนาคต

---

# 6. At Entry

At Entry มีหน้าที่บันทึกสถานการณ์ตอนเข้า Trade โดยไม่ทำให้ workflow การเทรดหนักเกินไป

Core information:

- Account
- Symbol
- Direction
- Entry time
- Risk at Entry
- Fixed Target / No Fixed Target
- Exit Plan
- Save Open Trade

Save Open Trade ต้องมี:

- Account
- Symbol
- Direction
- Risk at Entry (มากกว่าศูนย์ — ดู §4)

Entry time อาจ default เป็นเวลาปัจจุบันเพื่อ capture เร็ว แต่ต้องแก้ไขได้และ clear ได้เมื่อ trader ไม่ทราบเวลา หรือ default ผิด

Core Analytical Data:

- Strategy
- Setup
- Setup conditions
- Confidence
- Entry emotions

Optional contextual data:

- Trade idea / reason
- timeframe
- session
- notes
- chart
- price levels
- size

Strategy/Psychology/Discipline data สามารถ optional สำหรับการ Save แต่ไม่ถือเป็นข้อมูลที่ไม่มีความสำคัญ เพราะเป็น input หลักของ analytics

At Entry ไม่ควรมี:

- Final P&L
- Trader Outcome
- System Result
- System Assessment
- Review

---

# 7. Strategy and Setup

Strategy states:

- Unanswered
- No Strategy
- Selected Strategy

Setup states:

- Unanswered
- No Setup
- Selected Setup

`Unanswered` ห้าม collapse เป็น `No Strategy` หรือ `No Setup`

Strategy/Setup Performance ใช้เฉพาะข้อมูลที่มี semantic ชัดเจน

Strategy และ Setup สามารถมี conditions/rules ที่โหลดมาให้ user ตอบตอน Capture

rule ที่ใช้กับ Trade ควรสะท้อน version ณ เวลานั้น ไม่ใช่ถูก rewrite ตาม Strategy ที่แก้ในอนาคต

After Trade ห้ามใช้ Strategy default ปัจจุบันโดยอัตโนมัติ และห้ามอ้างว่าเป็น historical Strategy/rule version เว้นแต่ระบบพิสูจน์ได้จริงว่า version นั้นมีอยู่ ณ เวลาเข้า Trade

## Capture origin

Strategy, Setup, setup conditions และ Exit Plan ใช้หลัก observation origin เดียวกับ Psychology (ดู §9):

- `recorded_at_entry` — อยู่ใน Save Open Trade ครั้งแรกที่สำเร็จ
- `recorded_during_trade` — ถูกให้ครั้งแรกภายหลัง ขณะที่ Trade ยังเปิดอยู่
- `recalled_after_trade` — ถูกให้ครั้งแรกหลัง Trade ปิดแล้ว รวมถึง saved rule ที่ถูกเลือกระหว่าง After Trade reconstruction

การแก้ไขภายหลังต้องรักษา origin เดิม และบันทึก revision แยก (ดู §9 Revision metadata)

origin สะท้อน recording context จริง ไม่ใช่ route ที่ Draft เริ่มต้น (ดู §23)

---

# 8. Setup Conditions and Entry Discipline

At Entry condition:

- Met
- Not Met
- Unanswered

After Trade สามารถเพิ่ม:

- Unknown / Don't remember

Unanswered หรือ Unknown ห้ามถูกนับเป็น Not Met

ระบบต้องไม่คำนวณ Discipline Performance โดยถือ missing observation เป็น failure

Entry Discipline แยกจาก Exit Discipline

## Execution Rules (granular evidence)

Execution rule checks ระดับ rule ที่มีอยู่ต้องถูกเก็บไว้เป็น granular evidence

Conceptual mapping:

- entry rules → Entry Discipline
- risk rules → Risk Discipline
- exit rules → Exit Discipline
- management / invalidation rules → คงเป็น granular rule evidence ของตัวเองตามความเหมาะสม

`Not Applicable` ยังคงเป็น state ที่ valid

`Not Checked` / Unanswered ห้ามถูกนับเป็น violation

**Amended 2026-09-20 (decisions 41–42):** rule-check answers are **Unanswered** (no Review answer), **Followed**, **Violated**, **Not Applicable**, **Not Checked** (the trader explicitly did not check or apply the rule at the time) and **Unknown** (the trader cannot remember or determine what happened). Unanswered, Not Checked and Unknown are distinct and never collapsed, and only Violated is a violation. A historical `not_checked` on an Add Trade v1 row created before this state model is read as Unanswered, because it may have been a system default; legacy rows keep their historical Not Checked with legacy provenance. See [Review & System Assessment §5](review-system-assessment.md#5-rule-check-semantics).

Exit Plan Adherence (§18) เป็น trade-level summary และอยู่ร่วมกับ granular exit-rule checks ได้ แต่ห้ามกลายเป็นคำตอบที่แข่งกันสำหรับคำถามเดียวกัน

---

# 9. Psychology

Psychology เป็น observation ที่มี phase ไม่ใช่ property เดียวของ Trade

## At Entry

สามารถเก็บ:

- Confidence
- Entry Emotion

Confidence ไม่มี default value

เช่น:

null = unanswered  
0 / 25 / 50 / 75 / 100 = user เลือกจริง

Emotion ต้องแยก:

- unanswered
- None of these
- selected emotion(s)

## Provenance

Psychology provenance อิงจาก **เวลาที่ observation ถูก capture จริง** ไม่ใช่เส้นทางที่สร้าง Trade

Provenance แยกเป็นสอง concept ที่ห้ามรวมกัน: **Observation origin** และ **Revision metadata**

### Observation origin

เวลาที่ observation ถูก capture ครั้งแรก อย่างน้อย:

- `recorded_at_entry` — อยู่ใน snapshot ของ Save Open Trade ครั้งแรกที่สำเร็จ
- `recorded_during_trade` — ถูก capture ครั้งแรกภายหลัง ขณะที่ Trade ยังเปิดอยู่
- `recalled_after_trade` — entry-context information ที่ถูกให้ครั้งแรกหลัง Trade ปิดแล้ว

Psychology ที่ถูกเพิ่มภายหลัง ห้ามกลายเป็น `recorded_at_entry` โดยเงียบ ๆ เพียงเพราะ Trade ยังเปิดอยู่ หรือเพราะ Trade ถูกสร้างจาก At Entry

entry psychology ที่บันทึกใน After Trade เป็น `recalled_after_trade`

### Revision metadata

การแก้ไขภายหลังต้องรักษา observation origin เดิมไว้ และบันทึกแยกว่าถูกแก้ไขภายหลัง

การแก้ไขห้าม rewrite origin เดิม เช่น:

- Entry Emotion ที่อยู่ใน Save Open Trade ครั้งแรกยังเป็น `recorded_at_entry` แม้ trader แก้ไขภายหลัง
- entry emotion ที่ให้ครั้งแรกหลัง Trade ปิด ยังเป็น `recalled_after_trade` แม้ถูกแก้ไขอีก

## Post-Trade Emotion

บันทึกได้ระหว่าง:

- Final Close
- After Trade
- Review

Post-Trade Emotion ต้องแยกจาก Entry Emotion และห้าม overwrite Entry Emotion

Review interpretation ห้าม rewrite original observation แบบเงียบ ๆ

---

# 10. Partial Close and Exit Events

แต่ละ exit event รองรับ:

- Part / All Remaining (ดู Scope rules)
- P&L for this exit — optional
- % of original position — optional
- Exit time — optional
- Exit price — optional
- Exit reason — optional

`All Remaining` ปิด position แม้ percentage ของ exits ก่อนหน้าไม่สมบูรณ์

P&L ของ exit ไม่ถูกคูณด้วย percentage ซ้ำ

Reason-only exit เป็น valid observation ใน After Trade reconstruction

Missing price, time หรือ percentage ไม่ทำให้ exit invalid

## Scope rules

**Live existing trade / Record Exit:**
scope ต้องเป็น `Part` หรือ `All Remaining` เพราะมีผลต่อ lifecycle

**After Trade reconstruction:**

- scope อาจเป็น Unknown / Unanswered
- reason-only exit observation เป็น valid
- exit ที่ไม่ทราบ scope ห้ามถูกใช้ derive remaining-position lifecycle

---

# 11. Final Close

Trade ที่เริ่มจาก At Entry สามารถ:

Open → Partially Closed → Closed

Partial Close ยังไม่มี Final Net P&L ของทั้ง Trade

เมื่อ position ปิดทั้งหมด:

- Final Net P&L
- Trader Outcome
- exit-history completeness

จึงสามารถถูกบันทึกได้

## Final Close confirmation

Final Close ของ existing Open / Partially Closed Trade ต้องมีการยืนยันอย่าง explicit ว่า position ที่เหลือถูกปิดแล้ว เช่น exit scope `All Remaining` หรือ action `Close Remaining`

Final Net P&L และ Trader Outcome ควรถูก prompt อย่างชัดเจน แต่ยังเป็น optional

ค่าที่ไม่ได้บันทึกยังคงขาด ลด analytical coverage และห้ามถูกสร้างขึ้นเอง

## Final Net P&L

**Amended 2026-09-25 (decision 57) for new Record Closed capture:** Record Closed has one result
source — how the Trade closed. Final Net P&L is derived from the close (a full close's P&L, or the
sum of the exits once they prove the whole position closed) and is never typed beside it — except
that a close in parts whose exits are not known may state its final total instead (decision 58); "Use
recorded exits as final result", the explicit completeness question and the discrepancy notice
below no longer apply to it. The text below still governs Close Existing Open Trade and every
Trade saved with a stated Final Net P&L.

Final Net P&L เป็น authoritative monetary result ของ Closed Trade

Exit subtotal เป็น supporting history

ถ้า evidence ครบ (exit history ถูกระบุว่า Complete และทุก exit ที่เกี่ยวข้องมี P&L) ระบบสามารถเสนอ:

Use recorded exits as final result

แต่การ adopt ต้อง explicit

**Discrepancy** มีได้เฉพาะเมื่อครบทุกข้อ:

- exit history ถูกระบุอย่าง explicit ว่า Complete
- ทุก exit ที่เกี่ยวข้องมี P&L
- recorded exit subtotal ต่างจาก Final Net P&L

Discrepancy ไม่ block การ Save หรือ Close ทั้งสองค่าถูกเก็บและแสดง และ Final Net P&L ยังคงเป็น authoritative

ถ้า exit history เป็น Incomplete, Unknown หรือ Unanswered ความต่างนั้นห้ามถูกเรียกว่า discrepancy

ห้าม overwrite อย่างใดอย่างหนึ่งเงียบ ๆ

Incomplete exit history ไม่ block การปิด Trade

---

# 12. Trader Outcome

Trader Outcome เป็น classification ที่ผู้ใช้เลือกเอง:

- Win
- Break-even (BE)
- Loss
- Unanswered

Trader Outcome ไม่ derive จากเครื่องหมายของ P&L

ตัวอย่าง valid:

Actual P&L = +$10  
Actual R = +0.2R  
Trader Outcome = BE

เพราะ trader อาจมอง trade นี้เป็น scratch/breakeven ตามระบบของตัวเอง

P&L, R และ Trader Outcome เป็นข้อมูลคนละ semantic

BE อยู่คู่กับ P&L ที่เป็นบวกหรือลบได้ตาม classification ของ trader

ถ้า trader เลือก:

- Win คู่กับ Final Net P&L ติดลบ หรือ
- Loss คู่กับ Final Net P&L เป็นบวก

ให้อนุญาต แต่แสดง notice แบบเงียบ ๆ ที่ไม่ block เพื่อให้เห็น input ที่อาจผิด ห้าม auto-correct และห้าม block Save

Analytics ต้องแยก Trader Outcome ออกจาก objective Net P&L และ R metrics

## Legacy Trader Outcome

Trader Outcome เดิมที่ระบบ derive ไว้ก่อน contract นี้ต้องถูกเก็บไว้ ไม่ reset เป็น Unanswered และต้องมี provenance ว่า legacy/derived

ห้ามแสดง legacy-derived Outcome ราวกับว่า trader เลือกเอง (ดู §28)

legacy-derived Outcome ถูก exclude จาก canonical Trader Win Rate โดย default (ดู §25)

---

# 13. After Trade

After Trade มีหน้าที่บันทึก Trade ที่ปิดไปแล้ว โดยยอมรับว่าข้อมูลบางอย่างอาจไม่ทราบ

Core identity (minimum Trade identity):

- Account
- Symbol
- Direction

Optional timing:

- Entry time
- Final exit time

Risk / exit intention:

- Risk at Entry (Intended Risk — 1R baseline)
- Actual Risk: เริ่มต้น Unanswered จนกว่า trader จะระบุ Matched / Different (บันทึกค่า) / Don't know — ดู §4
- Fixed Target / No Fixed Target
- Exit Plan

Actual Result:

- Final Net P&L
- Trader Outcome
- Actual R when sufficient data exists

Exit history:

- exit events
- completeness:
  - Complete
  - Incomplete
  - Unknown
  - Unanswered

Analytical context:

- Strategy
- Setup
- Conditions
- Recalled Confidence
- Recalled Entry Emotion
- Post-Trade Emotion
- Trade idea/context

ข้อมูลที่ user กรอกใน Capture flow ต้อง persist เมื่อ Save Closed Trade

Strategy / Exit Plan default ของปัจจุบันห้ามถูก apply อัตโนมัติ (ดู §5, §7)

Exit event scope อาจเป็น Unknown / Unanswered (ดู §10)

Reflection และ System Assessment ไม่ใช่ requirement ของ Save Closed Trade

## Save Closed Trade

Save Closed Trade (After Trade / historical Closed Trade) ต้องมี minimum Trade identity:

- Account
- Symbol
- Direction

After Trade สามารถ Save Closed Trade ได้โดยไม่มี Risk at Entry, Final Net P&L หรือ Trader Outcome — ค่าเหล่านี้ยังเป็น optional สำหรับ historical Closed Trade capture

ค่าที่ไม่ได้บันทึกยังคงขาด ลด analytical coverage (เช่น Actual R เป็น unavailable เมื่อไม่มี Risk at Entry หรือ Final Net P&L) และห้ามถูกสร้างขึ้นเอง

Final Net P&L และ Trader Outcome ควรถูก prompt อย่างชัดเจน แต่ไม่ block การ Save

**Decision 57:** in Record Closed the Final Net P&L is not a separate input — it is derived from how
the Trade closed (a full close's P&L, or the sum of the exits once they prove the whole position
closed), or — for a close in parts whose exits are not known — the trader's stated total
(decision 58). A close in parts recorded exit by exit that does not yet prove the close saves with
no Final Net P&L.

Risk at Entry, Final Net P&L และเวลาใน historical capture อาจเว้นว่างเมื่อไม่ทราบหรือไม่ได้บันทึก โดยไม่ต้องมี explicit Unknown control (ดู §24)

---

# 14. System Assessment

System Assessment เป็น Review activity

ไม่ block การ Save หรือ Close Trade แต่ status ต้อง visible

Assessment finding อย่างน้อย:

- Not Assessed
- Assessed
- Cannot Determine
- No Trade

Not Assessed เป็น soft attention state

Cannot Determine และ No Trade ถือว่า assessment ได้รับคำตอบแล้ว ไม่ควรถูกเตือนว่า incomplete

## Needs Review overlay

`Needs Review` ไม่ใช่ finding ที่ exclusive กับ finding อื่น แต่เป็น staleness/attention overlay บน System Assessment ที่เคยยืนยันแล้ว เมื่อ dependency จริงของมันเปลี่ยน (ดู §22)

finding ที่ยืนยันแล้ว เช่น Assessed, No Trade หรือ Cannot Determine อาจ stale และต้อง review โดย finding เดิมต้องถูกเก็บไว้

Needs Review เป็น stronger attention state UI อาจแสดง `Needs Review` เป็นหลัก แต่ confirmed assessment เดิมต้องยังคงอยู่

---

# 15. System Assessment flow

System Assessment ต้องตอบ:

1. Would your rules have taken this trade?
2. ถ้า Yes — What should have closed it?
3. What result would following the rule have produced? — Money (แนะนำ) หรือ R
4. System R
5. Were these rules actually in place before entry?
6. Did the trader follow them? — ใช้ canonical **Exit Plan Adherence** field เดียว (ดู §18)
7. ถ้า deviated — how and why?

System Result ต้องมาจากสิ่งที่ผู้ใช้ยืนยัน ไม่ใช่ระบบเดาจาก actual result หรือ Price

System exit mechanism สามารถเป็น:

- Fixed Target
- Initial SL
- Break-even rule
- Trailing exit
- Time/session exit
- Another predefined exit rule
- Discretionary judgement explicitly allowed by the system

Dynamic Exit Plan เช่น trend-line break ให้ผู้ใช้บอก monetary result (หรือ R) ที่ rule นั้นควรได้

## System result evidence

- monetary result → derive `System R = System Money / Risk at Entry`
- direct R → System R เป็น known และ System Money อาจยังเป็น Unknown

Price ห้ามใช้คำนวณ System Result หรือ System R

ถ้า Fixed Target มีแค่ TP price และ trader ยืนยันว่า target ถูกชน ต้องขอ System Result เป็น Money หรือ R จาก trader

## Comparability

System result ต้องเก็บว่าเปรียบเทียบกับ Actual ได้หรือไม่:

- net / comparable
- gross only เพราะไม่ทราบ costs

Gross-only System result ห้ามสร้าง System-vs-Actual Difference ราวกับว่าเปรียบเทียบกันได้โดยตรง

---

# 16. System Result

System side ไม่ใช้ Trader Outcome terminology

System Result แสดงด้วย:

- Money
- R
- No Trade
- Cannot Determine

## System Result buckets

Canonical System Result แบ่ง bucket ตามค่าตัวเลขของ System Result (System Money หรือ System R — เครื่องหมายเดียวกันเสมอเพราะ Risk at Entry เป็นบวก):

- **Positive** — System Result > 0
- **Flat** — System Result = 0
- **Negative** — System Result < 0

ห้ามใช้ legacy ±0.05R break-even tolerance กับ canonical System Result classification เช่น:

- +0.01R = Positive
- 0R = Flat
- −0.01R = Negative

Exit mechanism เช่น `Break-even rule` แยกจาก numeric bucket — break-even rule อาจให้ net System Result ติดลบเล็กน้อยหลังหัก costs

bucket เหล่านี้ไม่เรียก Win/Loss/BE

Win/Loss/BE สงวนไว้สำหรับ Trader Outcome

---

# 17. System vs Trader

Report หลักควรยังเน้น:

- System R
- Actual R
- Difference / Execution Impact

ไม่ควรแสดง R หลายแบบจน user สับสน

Difference คำนวณเฉพาะเมื่อ System result เป็น net/comparable และทั้ง System R และ Actual R ใช้ Risk at Entry เป็น denominator เดียวกัน

Risk discipline เช่น Intended Risk vs Actual Risk เป็น secondary insight

ตัวเลขภายในเพิ่มเติมสามารถใช้สำหรับ analytics โดยไม่จำเป็นต้องแสดงทั้งหมดใน UI

---

# 18. Exit Plan Adherence

Exit Plan Adherence เป็นแกนแยกจาก System Result และมี **canonical stored answer เดียว**:

- Followed
- Partly
- Not Followed
- Unknown / Cannot Determine — trader ตัดสินไม่ได้ว่าทำตามหรือไม่ (amended 2026-09-20, decision 44)
- Not Applicable — เฉพาะเมื่อ Trade มี Exit Plan เป็น `No Defined Exit Rule` อย่าง explicit
- Not Answered

ถ้า Exit Plan เป็นเพียง `Not recorded` ห้าม infer `Not Applicable` adherence ยังคงเป็น Not Answered จนกว่า trader จะตอบ

แสดงได้ทั้งใน Discipline และ System Assessment แต่ห้ามเก็บเป็นคำตอบซ้ำสองชุด

Exit Plan ที่ Not recorded หรือ recalled ไม่ได้ทำให้คำตอบเป็น Unknown อัตโนมัติ ถ้า trader ยังตัดสินได้ก็ตอบได้

**Commit concurrency (decision 45):** the one adherence field may be committed by Finish Review or by Confirm / Update System Assessment. There is no silent last-write-wins: a commit whose starting value has since changed shows the latest saved answer and the draft answer, and only an explicit Replace overwrites the newer saved value. See [Review & System Assessment §7.3](review-system-assessment.md#73-adherence-concurrency).

Entry Discipline และ Risk Discipline เป็นแกนแยกต่างหาก

Exit Plan Adherence เป็น trade-level summary อยู่ร่วมกับ granular exit-rule checks (§8) ได้ แต่ห้ามเป็นคำตอบที่แข่งกันสำหรับคำถามเดียวกัน

การไม่ทำตาม Exit Plan ไม่ได้แปลว่า execution แย่โดยอัตโนมัติ

ถ้า deviated ระบบสามารถบันทึกเพิ่มเติม:

Deviation Type เช่น:

- Early exit
- Late exit
- Different exit
- Other

และ Deviation Reason เช่น:

- Emotion
- Discretionary decision
- Risk management
- Execution mistake
- External reason
- Other

Exact taxonomy ต้องผ่าน UX/prototype validation อีกครั้ง

Deviation Type / Reason ยังเป็น product concept แต่ taxonomy เป็น provisional และห้าม freeze เป็น rigid database enum ก่อน UX validation

---

# 19. Execution Impact

System Result กับ Trader Result ต้องสามารถใช้วิเคราะห์ผลของ execution ได้

ตัวอย่าง:

System R = +1.0R  
Actual R = +0.6R  
Difference = -0.4R

TradeChemist สามารถวิเคราะห์ได้ว่า deviation ทำให้ผลดีขึ้นหรือแย่ลง

Adherence กับ Execution Impact เป็นคนละ metric

ตัวอย่าง:

Not Followed + Positive Impact

เป็น valid state

เพราะ discretionary action อาจช่วยผลลัพธ์จริง

Analytics จึงสามารถแยก:

- Fear-driven early exits
- Discretionary overrides
- Late exits
- Risk-management overrides

และดู average impact ของแต่ละ behavior ได้

---

# 20. Review lifecycle

Trade lifecycle กับ Review lifecycle เป็นคนละแกน

Trade lifecycle:

- Open
- Partially Closed
- Closed
- Canceled

Review lifecycle:

- Not Reviewed
- Reviewed

`Needs Review` เป็น overlay ของ System Assessment เท่านั้น ไม่ใช่ Review lifecycle state (ดู §14, §22)

Closed Trade ไม่ได้แปลว่า Reviewed

หลัง:

- Save Closed Trade
- Final Close / Close Remaining ที่ปิด existing trade

แสดง:

Trade Saved

ผู้ใช้สามารถเลือก:

- Review Trade
- Done

ห้ามเสนอ Review หลัง Save Open Trade

Review ไม่บังคับ

แต่ Not Reviewed และ Not Assessed สามารถมี soft attention indicator ได้

## Review availability

Formal Review มีเฉพาะ Trade ที่ Closed แล้ว

Open และ Partially Closed Trade สามารถมี notes และ data capture ปกติได้ แต่ไม่ถูก Reviewed อย่างเป็นทางการ

## Reopening a Review

Reviewed Trade ไม่กลับเป็น Not Reviewed

Review สามารถถูกเปิดใหม่และแก้ไข แล้ว Finish อีกครั้งได้ การ Finish อีกครั้งจะ update review completion metadata

System Assessment staleness (`Needs Review`) ยังคงแยกจาก Review lifecycle

## Canceled

Canceled ยังเป็น Trade lifecycle state แต่ UX การสร้างหรือ transition ไป Canceled อยู่นอก scope ของ Add Trade redesign v1

ห้ามคิด Cancel Trade flow ใหม่ใน redesign นี้

---

# 21. Review responsibilities

Review แบ่ง conceptually เป็น:

## Reflection

- What would you repeat?
- What would you change?

ทั้งสองข้อเป็น optional การกด Finish Review โดยเว้นว่างทั้งสองข้อคือ `Reviewed — nothing else to add` ซึ่งเป็น valid completion และไม่ต้องเก็บค่าแยก

**Amended 2026-09-20 (decision 43):** "What happened?" is removed. Capture is authoritative for what happened, and Review never asks the trader to narrate Capture again.

## Discipline / Behavior

- Entry Discipline
- Risk Discipline
- Exit Plan Adherence
- Deviation Type
- Deviation Reason
- Mistakes

## System Assessment

- system eligibility
- exit rule
- system result
- system R
- provenance
- Exit Plan Adherence (field เดียวกับใน Discipline / Behavior)
- System vs Actual comparison

ไม่มี completion percentage

ไม่มี requirement ว่าต้องมี note / mistake / Strategy / System Assessment จึงถือว่า Reviewed

Reviewed เป็น explicit user action

---

# 22. Needs Review

ข้อมูลที่เคยยืนยันแล้วต้องไม่ถูก rewrite เงียบ ๆ เมื่อ dependencies เปลี่ยน

`Needs Review` เป็น staleness overlay ที่เกิดได้เฉพาะกับ **System Assessment ที่ยืนยันแล้ว** เมื่อ dependency จริงของมันเปลี่ยน โดย finding เดิมยังถูกเก็บไว้ เช่น:

- Strategy changed
- Setup changed
- Exit Plan changed
- Risk at Entry changed
- Target changed

เฉพาะ dependency ที่ assessment นั้นใช้จริงเท่านั้นที่ทำให้ stale ไม่ใช่แก้อะไรก็ invalidate ทุกอย่าง

**Final Net P&L ไม่ใช่ dependency ของ System Result** ถ้า Final Net P&L เปลี่ยน ให้ recompute Actual R / Difference ตามที่เกี่ยวข้อง ห้ามทำให้ System Assessment stale เพียงเพราะ Actual เปลี่ยน

Reflection ไม่ถูก invalidate อัตโนมัติ

---

# 23. Draft lifecycle

Recording Draft เป็นคนละสิ่งกับ persisted Trade

หลัก:

**Type → Draft**

**Save → Persist**

**Discard → Destroy**

Nested editors เป็น view ของ Draft เดียวกัน

Done:
เก็บ changes แล้วปิด editor

X / Escape / outside dismissal:
เก็บ changes แล้วปิด editor

Discard Changes:
explicitly restore editor checkpoint

Back / Close:
navigate โดย Draft ยังอยู่

Reload:
Add Trade Recording Draft และ Review Draft ต้อง recover ได้ใน browser/device เดิม (ดู Draft scope)

Change At Entry / After Trade:
Draft เดิมห้ามถูกทำลายเงียบ ๆ (ดู Recording mode switch)

Cross-device draft sync ยังไม่ใช่ requirement

Save failure ต้องรักษา Draft

Save retry ต้องไม่สร้าง duplicate Trade

## Recording mode switch

หลัก: **ค่าที่ user กรอกเองสามารถ carry ข้าม recording mode ได้ แต่ contextual default ห้ามกลายเป็น historical answer เงียบ ๆ**

Draft preservation รักษางานของ user ไม่ใช่ system assumption ที่ยังไม่ถูกยืนยัน default อาจมี state ที่บอกว่ายังเป็นเพียง default จนกว่า trader จะยืนยันหรือเปลี่ยน

เมื่อสลับ At Entry → After Trade:

- ค่าร่วมที่ trader กรอกหรือเลือกเองอย่าง explicit และ semantics ยัง valid ถูก carry ข้าม เช่น Account, Symbol, Direction, Risk at Entry ที่กรอกเอง, Strategy / Setup ที่เลือกเอง, Exit Plan ที่เลือกเอง และ explicit shared observation อื่น
- **Entry time:** ถ้า trader แก้ไขหรือยืนยัน Entry time อย่าง explicit ให้เก็บไว้ ถ้ายังเป็น automatic `now` default ที่ไม่ถูกแตะ ห้าม carry เป็น historical answer และ After Trade แสดง Entry time เป็น Unanswered
- **Actual Risk** ที่ trader ยืนยันเองว่า Matched ห้าม carry ข้ามเป็นคำตอบของอีก recording moment — คำตอบเกี่ยวกับ Trade หนึ่งไม่ใช่หลักฐานของอีก Trade หนึ่ง ทั้ง At Entry และ After Trade เริ่มต้นเป็น Unanswered (ดู §4, decision 52)
- **Strategy-default Exit Plan ที่ถูก inherit อัตโนมัติ** ห้าม carry เป็น confirmed answer — After Trade ไม่ apply Strategy / Exit Plan default ย้อนหลัง (ดู §5)

ทุกทิศทางของการสลับ:

- ค่าเฉพาะ mode ยังอยู่ใน Draft และอาจถูกซ่อนเมื่อไม่เกี่ยวข้อง ห้ามถูกลบเงียบ ๆ แต่ default ที่ไม่ compatible ห้ามถูกถือเป็น confirmed answer
- การสลับ recording mode ต้องไม่ทำลายงาน
- provenance และ semantics สุดท้ายต้องสะท้อน recording context จริง ไม่ใช่เพียง route ที่ Draft เริ่มต้น

## Draft scope

- Routine dismissal ที่ไม่ทำลายข้อมูลใช้กับทุก editor
- Durable reload recovery จำเป็นสำหรับ Add Trade Recording Draft และ Review Draft
- Record Exit, Final Close และการแก้ไข saved Trade ต้องรักษางานข้าม routine dismissal ระหว่าง interaction แต่ durable reload recovery ยังไม่ใช่ requirement ของ v1 สำหรับ flow ที่สั้นกว่านี้

## Draft privacy

- Draft ถูก scope ตาม user และ workspace และห้ามปรากฏใน context ของ user หรือ workspace อื่น
- Explicit sign-out ล้าง local unsaved drafts
- ถ้ามี unsaved draft อยู่ sign-out ต้องเตือนก่อนทำลาย
- Automatic draft-retention TTL เป็น implementation policy ไม่ใช่ product decision ที่ต้องมีก่อน redesign

---

# 24. Global state semantics

TradeChemist ต้องรักษาความต่างระหว่าง:

- Unanswered
- Unknown
- None
- Known Zero
- Known Value
- Negative answer

ตัวอย่าง:

ไม่ได้เลือก Strategy ≠ No Strategy

ไม่ได้ตอบ condition ≠ Not Met

Target blank ≠ No Fixed Target

Emotion unanswered ≠ None of these

Unknown Risk ≠ $0 Risk

P&L unknown ≠ Break-even

Actual risk ยืนยันว่าตรง (explicit Matched) ≠ Actual Risk unknown (Don't know) ≠ Actual Risk unanswered (ยังไม่ได้ตอบ — ค่าเริ่มต้นของทั้ง At Entry และ After Trade ตั้งแต่ decision 52)

Legacy-derived Trader Outcome ≠ Trader Outcome ที่ trader เลือกเอง

Observation origin ≠ Revision metadata (`recorded_at_entry` ที่ถูกแก้ไขภายหลัง ≠ `recorded_during_trade`)

Legacy R ≠ canonical R

Inherited Exit Plan ≠ Exit Plan ที่ trader เลือกเอง ≠ inheritance ที่ถูก trader ปฏิเสธ

Exit scope unknown ≠ Part ≠ All Remaining

System result gross-only ≠ net/comparable

Actual Risk: Different แต่ไม่ทราบจำนวน ≠ Matched

Exit Plan Adherence Not Applicable (No Defined Exit Rule) ≠ Not Answered (Exit Plan Not recorded)

Risk at Entry ว่าง ≠ Risk at Entry = 0 (Risk at Entry ที่ทราบค่าต้องมากกว่าศูนย์)

## Explicit Unknown controls

explicit `Don't know` / Unknown control ใช้เฉพาะเมื่อ uncertainty ที่ explicit เปลี่ยน product meaning เช่น Actual Risk, setup conditions ใน After Trade, exit scope ใน After Trade และ exit-history completeness

ไม่ต้องเพิ่ม `Don't know` control ให้ทุก optional field

Risk at Entry, Final Net P&L และเวลาใน historical capture อาจเว้นว่างเมื่อไม่ทราบหรือไม่ได้บันทึก เว้นแต่ Product Contract กำหนด Unknown state แยกไว้โดยเฉพาะ ค่าว่างยังคงไม่เท่ากับศูนย์หรือ Break-even

---

# 25. Analytics principles

## Trader Performance

ใช้:

- Final Net P&L
- Actual R
- Trader Outcome

Trader Outcome แยกจาก objective Net P&L / R metrics

### Trader Win Rate

Canonical **Trader Win Rate** ใช้เฉพาะ Trader Outcome ที่ trader classify อย่าง explicit ภายใต้ contract นี้

- BE ไม่ถูกนับใน numerator แต่อยู่ใน denominator
- Unanswered ไม่ถูกนับ และห้ามถูกนับเป็น Loss
- legacy-derived Trader Outcome ถูก exclude จาก canonical Win Rate โดย default (§28)

ห้ามรวม algorithm-derived legacy outcome กับ trader-selected outcome โดยเงียบ ๆ

## System Performance

ใช้:

- System Result
- System R
- No Trade
- Cannot Determine

### System Positive Rate

**System Positive Rate** แทน `System Win Rate` สำหรับ Add Trade model ใหม่:

`System Positive Rate = Positive / eligible canonical System Results` (Positive + Flat + Negative)

อาจแสดง **System Result Distribution**: Positive / Flat / Negative

Denominator ใช้เฉพาะ eligible canonical System Results และ exclude:

- Not Assessed (ยังไม่มี System Result)
- No Trade
- Cannot Determine
- assessment ที่ stale / Needs Review จนกว่าจะ reconfirm
- gross-only result — ทุก gross-only result ถูก exclude จาก canonical aggregate System metrics ใน v1 (System Positive Rate, System Result Distribution, System R aggregates, Execution Gap และ net / comparable aggregate อื่น) แต่ยังเก็บ แสดงบน Trade และรายงานเป็น coverage ห้ามปน gross-only กับ net / comparable (clarified 2026-09-20, decision 47)
- legacy System results (§28)

record ที่ถูก exclude ต้องแสดงเป็น coverage อย่างซื่อสัตย์ ห้ามนับเป็น Negative โดยเงียบ ๆ

## Strategy Performance

ใช้:

- Strategy
- Setup
- relevant result metrics

## Discipline Performance

แยกอย่างน้อย:

- Entry Discipline
- Exit Discipline
- Risk Discipline (Actual Risk เทียบกับ Risk at Entry)

ไม่ควรยุบทุกอย่างเป็น Discipline score เดียวโดยอัตโนมัติ

## Psychology Performance

ใช้:

- Confidence
- Emotions
- observation phase/provenance

## Data coverage

Missing analytical data ต้องถูก exclude หรือแสดง coverage อย่างซื่อสัตย์

TradeChemist ต้องไม่แสดง insight ที่ดูแม่นเกิน evidence ที่มี

Correlation ต้องไม่ถูกเขียนเป็น causation

Legacy R ที่ definition ไม่ตรงกับ contract นี้ต้องถูก exclude จาก canonical metrics โดย default (ดู §28)

---

# 26. Language and terminology

TradeChemist ไม่ต้องแปล trading terminology ทุกคำ

ศัพท์ที่ trader คุ้นอยู่แล้วควรเก็บ เช่น:

- TP
- SL
- P&L
- R
- Win / Loss / BE
- Long / Short
- Entry / Exit
- Partial Close
- Risk
- Strategy
- Setup

สามารถใช้ศัพท์คู่กับคำอธิบาย เช่น:

Target Profit (TP)

Stop Loss (SL)

Net P&L — กำไร/ขาดทุนสุทธิของทั้ง Trade

Product-specific concepts เช่น:

- System Result
- Actual Result
- Exit Plan
- Execution Impact
- Risk Deviation
- Needs Review

ควรใช้ภาษาที่เข้าใจง่ายและมี helper text เมื่อจำเป็น

Internal technical terms เช่น:

- provenance
- calculation authority
- reconciliation state
- dependency snapshot
- persistence semantics

ไม่ควรถูก expose ให้ user

หลัก localization:

**Preserve familiar trading vocabulary. Localize for comprehension, not literal translation.**

---

# 27. UX principle

ผู้ใช้ไม่ควรต้องเข้าใจ complexity ของ data model

Mental model ที่ต้องการคือ:

## ตอนเข้า

What am I doing and why?

## ตอนปิด

What actually happened?

## ตอน Review

What should have happened, and what can I learn?

TradeChemist รับผิดชอบ complexity ที่เหลือหลังบ้าน

---

# 28. Existing (legacy) data

ข้อมูลเดิมก่อน contract นี้ต้องถูกเก็บไว้พร้อม provenance ที่ชัดเจน ห้ามแปลงให้ดูเหมือนเกิดจาก semantics ใหม่

## Legacy Trader Outcome

- เก็บค่า Trader Outcome ที่ derive ไว้เดิม
- ระหว่าง migration ให้ mark provenance เป็น legacy/derived ไม่ reset เป็น Unanswered
- ห้ามแสดงว่า trader เลือก Outcome นั้นเอง
- ยังแสดงบน historical Trade ได้เมื่อเป็นประโยชน์
- exclude จาก canonical Trader Win Rate โดย default อาจเพิ่ม legacy/historical cohort ที่ label แยกได้ในอนาคต แต่ห้ามรวมกับ trader-selected outcome โดยเงียบ ๆ

## Legacy risk

ถ้า Trade เดิมมี Actual Risk แต่ไม่มี Intended Risk ในอดีต:

- ห้ามสร้าง Intended Risk ขึ้นมา
- เก็บ risk เดิมเป็น **legacy 1R baseline** พร้อม provenance ว่ามาจาก historical Actual Risk
- วิธีนี้อาจรักษา historical R ไว้ได้ โดยไม่อ้างว่าตัวเลขนั้นคือความตั้งใจของ trader
- R ที่ได้เป็น legacy R ไม่ใช่ canonical R (ดู Legacy R analytics eligibility)

## Legacy Price-mode results

- ห้ามแปลง Price-mode หรือ `price_exit` history เป็น Money data
- เก็บเป็น legacy evidence/results พร้อม provenance ที่ชัดเจน
- แสดงในประวัติได้ แต่ห้าม qualify เป็น Money-authoritative result ตาม contract ใหม่โดยเงียบ ๆ

## Legacy R analytics eligibility

เก็บ legacy R และ provenance ไว้ แต่ห้ามปนเข้า canonical R analytics ใหม่เมื่อ definition ไม่ตรงกับ contract นี้ ได้แก่:

- legacy Actual R ที่ใช้ historical risk semantics
- legacy System R ที่ใช้ denominator ต่างกัน
- Price-mode / price-geometry R
- `price_exit` System results

ค่าเหล่านี้แสดงบน historical Trade record ได้พร้อม legacy provenance ที่ชัดเจน

โดย default ต้อง exclude ออกจาก canonical metrics เช่น:

- Average Actual R
- canonical System vs Actual comparison
- Execution Impact
- analytics อื่นที่ต้องใช้ common Risk-at-Entry baseline ใหม่

ห้ามสร้างหรือแปลงเป็น canonical value ใหม่ เว้นแต่ stored evidence เพียงพอจริงที่จะ reconstruct ภายใต้ contract นี้

อาจเพิ่ม legacy analytics cohort ที่ label แยกได้ในอนาคต แต่ legacy และ canonical definition ห้ามถูกรวมกันโดยเงียบ ๆ

---

# Decision log

Resolved 2026-09-14 from the v1 proposal review (items 1–11):

1. **Risk and R** — Risk at Entry is the 1R baseline for both System R and Actual R. Actual Risk is
   optional Risk Discipline data and never redefines Actual R. Not opening "Actual risk differed"
   is an honest, visible affirmation; After Trade keeps unknown distinct. (§4)
2. **Adherence** — one canonical Exit Plan Adherence answer, shown in Discipline and System
   Assessment; Deviation Type / Reason taxonomy stays provisional. (§18, §21)
3. **Strategy defaults in After Trade** — never auto-applied; explicit selection is recorded as
   recalled/selected during reconstruction; no unproven historical version claims. (§5, §7, §13)
4. **System Result and costs** — Money preferred, direct R allowed, Price never; results keep
   net/comparable vs gross-only, and gross-only produces no Difference. (§3, §15, §17)
5. **Fixed Target** — may hold monetary Target Profit, TP price, or both; TP price never
   calculates a System Result. (§5)
6. **Needs Review** — Review lifecycle is Not Reviewed / Reviewed; only a confirmed System
   Assessment becomes Needs Review; Final Net P&L is not a System dependency. (§14, §20, §22)
7. **Review after Save** — offered after Save Closed Trade and a closing Final Close / Close
   Remaining; never after Save Open Trade. (§20)
8. **Exit subtotal discrepancy** — only for an explicitly Complete, fully priced exit history that
   differs from Final Net P&L; non-blocking. (§11)
9. **Exit scope** — required for live exits; may be Unknown / Unanswered in After Trade
   reconstruction and then never drives lifecycle. (§10)
10. **Trader Outcome vs P&L** — user-classified; sign-contradicting choices are allowed with a
    quiet non-blocking notice. (§12, §25)
11. **Psychology provenance** — follows actual capture time; Post-Trade Emotion may be recorded at
    Final Close, After Trade or Review. (§9)

Final product decisions, 2026-09-14 (items 12–18):

12. **Save Open Trade minimum** — Account, Symbol, Direction and Risk at Entry are required; Entry
    time may default to now but stays editable and clearable. (§6)
13. **Existing data** — legacy derived Trader Outcomes are preserved with legacy/derived
    provenance; historical Actual Risk without Intended Risk becomes a legacy 1R baseline, never a
    manufactured Intended Risk; Price-mode and `price_exit` history stays legacy evidence and never
    silently qualifies as Money-authoritative. (§12, §28)
14. **After Trade Actual Risk** — starts Unanswered until Matched / Different / Don't know; an
    unknown Actual Risk does not block the primary comparison. (§4, §13)
15. **Strategy default Exit Plan** — At Entry may visibly inherit it until the trader makes an
    explicit choice; After Trade never inherits. (§5)
16. **Psychology provenance** — Recorded at Entry means included in the initial successful Save
    Open Trade snapshot; later additions or changes keep recalled/edited-later provenance. (§9)
17. **Execution Rules** — granular rule evidence is kept and mapped to Entry / Risk / Exit
    Discipline; Not Applicable is kept; Not Checked is never a violation; Exit Plan Adherence is a
    non-competing trade-level summary. (§8, §18)
18. **Needs Review** — a staleness overlay on a confirmed finding that preserves the finding.
    (§14, §22)

Closing product decisions, 2026-09-14 (items 19–21):

19. **Legacy R analytics eligibility** — legacy Actual R, differently-denominated legacy System R,
    Price-geometry R and `price_exit` results stay visible with legacy provenance but are excluded
    by default from canonical R metrics, System vs Actual comparison and Execution Impact; nothing
    is converted without sufficient evidence, and any legacy cohort is labelled separately. (§25,
    §28)
20. **Overriding an inherited Exit Plan** — an explicit override suppresses Strategy-default
    inheritance for that Trade until an explicit restore such as "Use strategy default"; avoid a
    generic "Clear" label. (§5)
21. **Psychology provenance and later edits** — observation origin (`recorded_at_entry`,
    `recorded_during_trade`, `recalled_after_trade`) is separate from revision metadata; an edit
    never rewrites the original origin. Supersedes the "recalled/edited-later" wording of item 16.
    (§9)

Analytics decisions, 2026-09-14 (items 22–23):

22. **System Positive Rate** — replaces System Win Rate for the Add Trade model. Canonical System
    Result buckets are Positive (> 0), Flat (= 0) and Negative (< 0) with no ±0.05R tolerance; an
    exit mechanism such as a break-even rule is separate from the bucket. The rate uses only
    eligible canonical System Results, excluding No Trade, Cannot Determine, stale assessments until
    reconfirmed, gross-only results (every gross-only result in v1 — decision 47) and legacy results,
    with coverage reported honestly.
    (§16, §25)
23. **Trader Win Rate and legacy outcomes** — canonical Trader Win Rate uses only trader-selected
    Trader Outcomes; legacy-derived outcomes stay stored, visible and provenance-marked but are
    excluded by default and never silently mixed. (§12, §25, §28)

UX boundary decisions, 2026-09-15 (items 24–37):

24. **Closed Trade requirements** — After Trade may save a Closed Trade without Risk at Entry,
    Final Net P&L or Trader Outcome; missing values stay missing, reduce analytical coverage and
    are never manufactured. Final Close of an existing Open / Partially Closed Trade requires
    explicit confirmation that the remaining position is closed; Final Net P&L and Trader Outcome
    are strongly prompted but optional. (§11, §13)
25. **Risk at Entry** — a known Risk at Entry must be greater than zero; zero never substitutes for
    unknown or missing risk. (§4, §6)
26. **Fixed Target** — requires at least one representation, Target Profit or TP price; a Fixed
    Target with neither is not a valid completed state; dynamic or non-fixed exit objectives
    belong in Exit Plan. (§5)
27. **Actual risk differed without an amount** — preserved as Different with the amount unknown,
    never silently reverted to Matched. (§4)
28. **Capture origin beyond psychology** — Strategy, Setup, setup conditions and Exit Plan use the
    same origin principle as psychology (`recorded_at_entry`, `recorded_during_trade`,
    `recalled_after_trade`); later edits keep the origin and record revision separately. (§7, §9)
29. **Switching At Entry / After Trade** — shared draft fields carry across; mode-specific values
    stay in the Draft, may be hidden and are never silently deleted; switching never destroys
    work; final provenance and semantics reflect the actual recording context, not the starting
    route. (§23)
30. **Draft scope** — non-destructive routine dismissal applies to all editors; durable reload
    recovery is required for Add Trade Recording Drafts and Review Drafts; Record Exit, Final
    Close and saved-trade editing preserve work across routine dismissal but need no durable
    reload recovery in v1. (§23)
31. **Draft privacy** — drafts are user- and workspace-scoped and never surface in another
    context; explicit sign-out clears local unsaved drafts after warning; automatic retention TTL
    is implementation policy. (§23)
32. **Review availability** — formal Review exists only for Closed Trades; Open and Partially
    Closed Trades may have ordinary notes and data capture but are not formally Reviewed. (§20)
33. **Review lifecycle** — a Reviewed Trade never returns to Not Reviewed; a Review may be
    reopened, edited and Finished again, which updates review completion metadata; System
    Assessment staleness stays separate. (§20)
34. **Exit Plan Adherence Not Applicable** — allowed only when the Trade explicitly has No Defined
    Exit Rule; a Not recorded Exit Plan never implies Not Applicable. (§18)
35. **Don't Know controls** — explicit Unknown controls only where uncertainty changes product
    meaning; Risk at Entry, Final Net P&L and timestamps in historical capture may stay blank
    unless a contract requires a distinct Unknown state. (§13, §24)
36. **Canceled Trades** — Canceled remains a lifecycle state; its creation and transition UX is
    outside Add Trade redesign v1, and no Cancel Trade flow is invented. (§20)
37. **Price-context inconsistencies** — a plausible semantic inconsistency such as a Long stop
    above Entry is a non-blocking data-quality notice; malformed price input may be an error;
    price-derived context such as distance or pips may be explored later but never becomes
    calculation authority. (§3)

Deliberately deferred (2026-09-15): final Thai copy and the Deviation Type / Reason taxonomy stay
open for UX/copy prototyping and are not frozen into rigid product or schema definitions (§18,
§26). Interaction rules applying this contract live in [`docs/UX_RULES.md`](../UX_RULES.md).

Pre-design semantics decisions, 2026-09-15 (items 38–40):

38. **After Trade minimum identity** — saving an After Trade / historical Closed Trade requires
    Account, Symbol and Direction, the minimum Trade identity; Risk at Entry, Final Net P&L and
    Trader Outcome stay optional, and missing values reduce coverage without being manufactured.
    Clarifies item 24. (§13)
39. **Fixed Target incomplete state** — an explicitly selected Fixed Target with neither Target
    Profit nor TP price blocks Save with a field-level validation error and is never silently
    converted to Unanswered or No Fixed Target. Clarifies item 26. (§5)
40. **Recording-mode switch and defaults** — user-entered values may carry across recording modes;
    contextual defaults never silently become historical answers. An untouched automatic `now`
    Entry time, an implicit Actual Risk match and an automatically inherited Strategy-default
    Exit Plan do not carry into After Trade as answers; explicitly entered or confirmed shared
    values do; hidden mode-specific data is kept but never treated as confirmed. Draft
    preservation preserves user work, not unconfirmed system assumptions. Refines item 29.
    (§23)

Review & System Assessment decisions, 2026-09-20 (items 41–49). Defined in full in
[Review & System Assessment](review-system-assessment.md):

41. **Rule-check answers** — Unanswered, Followed, Violated, Not Applicable, Not Checked (explicitly
    not checked at the time) and Unknown (cannot remember or determine) are distinct; only Violated
    is a violation. Amends §8.
42. **Historical `not_checked`** — on an Add Trade v1 row created before the new rule-check model it
    is read as Unanswered, because it may have been a system default; no explicit answer is
    manufactured. Legacy rows keep their historical Not Checked. Amends §8.
43. **Reflection** — _What would you repeat?_ and _What would you change?_, both optional; Finish
    Review with both blank is a valid explicit completion and no separate "nothing to add" value is
    stored. "What happened?" is removed because Capture is authoritative for it. Amends §21.
44. **Exit Plan Adherence Unknown** — Unknown / Cannot Determine joins Followed / Partly / Not
    Followed / Not Answered, and Not Applicable remains only for No Defined Exit Rule. A recalled or
    unrecorded plan does not make the answer Unknown automatically. Amends §18.
45. **Adherence concurrency** — the one adherence field is committed by Finish Review or Confirm /
    Update System Assessment under an optimistic check on that field; a changed base shows the latest
    saved and draft answers, and only an explicit Replace overwrites. Amends §18.
46. **System Result helpers** — _Use −1R / −Risk at Entry_ and _Use my Target Profit_ fill only the
    chosen basis (Money or R) where Capture supports it, on an explicit click; they never confirm,
    never decide Net vs Gross only, and never use Price. Elaborates §15.
47. **Gross-only results** — every gross-only System Result is excluded from every canonical
    aggregate System metric in v1 and reported as coverage; gross-only and net populations never mix.
    Resolves the "ineligible gross-only" wording of §25 and decision 22.
48. **Drafts, confirmation and corrections** — the Review Draft and the System Assessment Draft are
    browser-local until Finish / Confirm; System Assessment is confirmed independently of Finish
    Review, and only a confirmed finding is canonical or can become Needs Review; mistakes have an
    explicit _No mistake identified_; missing Capture evidence is added from Review only as a Capture
    correction with revision metadata; a later Capture change shows _Changed since your last Review_
    and creates no second stale state. Elaborates §14, §20–§23.
49. **Provenance and legacy** — confirmed assessments count in canonical System analytics whatever
    their rule provenance, with provenance preserved and reported as coverage, recalled evidence
    never called verified, and Q5 kept as a trader claim beside Capture origin; legacy notes never
    imply Reviewed, legacy closed Trades get no new Review attention, and no new legacy System
    resolutions are made once canonical System Assessment ships. Elaborates §7, §15, §28.

Recording-lifecycle decision, 2026-09-22 (item 50):

50. **One recording lifecycle** — Trade recording follows six canonical stages: Trade Details,
    Plan & Risk, Setup & Checklist, Entry Context & Evidence, Exit & Result, After-Trade Context.
    Record Open Trade uses stages 1–4 then Save Open Trade; Close Existing Open Trade uses stages
    5–6 and reaches Closed only through the §11 confirmation, with stages 1–4 kept as preserved
    context rather than re-entered; Record Closed Trade uses every stage in its own presentation
    order. Canonical stage order and task presentation order may differ. The lifecycle adds and
    changes no semantics: minimums, defaults (including At Entry Exit Plan inheritance and no
    After Trade inheritance), provenance, Money authority and multi-state conditions are unchanged.
    Review and System Assessment are not a stage and stay post-save for Closed Trades. (§1)

Lifecycle placement corrections, 2026-09-22 (item 51):

51. **Lifecycle placements** — Risk at Entry (the intended 1R) and Actual Risk (the risk
    execution actually carried at entry, compared with Risk at Entry) both belong to Plan & Risk.
    Actual Risk is an entry-time fact, not a post-trade question: Record Open Trade answers it at
    entry (§4 At Entry — Matched risk at entry / Different, both explicit since decision 52
    superseded the visible "matches" statement), and Record Closed Trade reconstructs the same
    fact in Plan & Risk (§4 After Trade — Matched / Different / Don't know). After-Trade Context may display it read-only but never asks it again, and no
    second risk-adherence capture question is introduced. A Part exit stays within Exit & Result
    and asks no whole-Trade Final Net P&L or Trader Outcome; After-Trade Context is reached only
    when All Remaining makes the Trade Closed. The Trade's existing notes belong to Entry Context &
    Evidence and are not reused for After-Trade Context; a distinct after-trade note would be its
    own later schema change. _Revised the same day: an earlier wording placed Actual Risk in
    After-Trade Context; that placement is withdrawn._ Refines item 50. (§1, §4)

Actual Risk at Entry amendment, 2026-09-23 (item 52):

52. **Actual Risk at Entry is an explicit answer** — Actual Risk at Entry starts **Unanswered**
    and becomes an answer only when the trader states one: **Matched risk at entry**, or
    **Different** with an amount or with the amount unknown. Matched is never inferred from the
    absence of a Different answer, and a Save from the unanswered state records no Actual Risk
    answer at all. This **amends v1 §4**, which read the unopened "Actual risk differed" control
    as the trader confirming a match and required the interaction to state that assumption
    visibly. That rule was coherent while the control carried its own qualifying sentence beside
    Risk at Entry; it stopped being honest once Plan & Risk was read as launcher rows, where a
    glanceable row has no room for "assumed until you say otherwise" and would either assert a
    match nobody stated or contradict what was saved. At Entry and After Trade now ask the same
    question the same way (§4 After Trade is unchanged).

    **Historical Trades are not touched.** A persisted `matched` recorded before this amendment
    was a real confirmation under the interaction contract that applied then, and stays a valid
    observation: no backfill, no reinterpretation, no re-derivation (§28 legacy provenance).

    **Drafts that cannot prove which state they hold migrate to Unanswered.** A stored draft from
    before this amendment spelled the untouched default `matched`, so an explicit confirmation and
    an untouched draft are indistinguishable in it. Such a draft is read as Unanswered:
    re-answering costs one tap, while the other reading would manufacture a positive observation
    (§2, §8). Amends §4; refines §23 and §27. (§4, §23, §27)

Stage placement and Stop Method, 2026-09-23 (item 53):

53. **Plan & Risk is the plan; Actual Risk is entry execution** — Plan & Risk (stage 2) holds only
    what was intended before entry: Risk at Entry, **Stop Method**, the Target, the Exit Plan and
    price context. **Actual Risk moves to Entry Context & Evidence (stage 4)**, where the rest of
    what actually happened at entry is recorded. Its meaning, its states and its explicit-answer
    rule (decision 52) are unchanged by the move, in both recording moments; it does **not** move
    to stage 5, which is the result.

    **Stop Method** is a new optional plan answer: **Unanswered** (the default), **Broker stop** (a
    stop order resting with the broker), **Mental stop** (a planned manual stop with no broker-side
    order) and **No defined stop** (an explicit answer that there was no defined stop approach).
    Unanswered is never "no defined stop" (§2, §8), and it is **never inferred from a recorded SL
    price**: `context_stop_price` says where a stop would sit, not whether one was placed, and stays
    Price Context (§3). Nothing in this slice derives a System Result, a risk amount or any
    adherence figure from it, and no Mental Stop rule text is captured yet.

    **Nothing historical changes.** No row is backfilled, and a persisted Actual Risk answer keeps
    its meaning and its provenance (§28). A draft written before this decision simply holds no Stop
    Method: absent is Unanswered, so it loads whole and nothing is invented for it. Amends §2 and
    §4; refines §23. (§2, §4, §23)

Planned Risk simplification, 2026-09-23 (item 54):

54. **Planned Risk is a three-state decision, and Stop Method is retired** — Planned Risk is
    **Unanswered**, **Defined Risk** (a planned 1R greater than zero) or **No Defined Risk** (an
    explicit answer that no 1R was set). The three never collapse: Unanswered is not No Defined
    Risk, and No Defined Risk is not a zero (§2, §8). **Record Open requires the decision, not the
    money** — Defined with its amount, or No Defined Risk — so a trader who traded without a 1R
    records that truthfully instead of inventing one. After Trade may still leave it Unanswered
    for a historical Trade.

    **No Defined Risk forecloses the R family.** No Actual R, Trader R or RR is produced for such
    a Trade whatever its Target, and Actual Risk is not asked at all: "did what you risked match
    your plan?" has no answer when there was no plan to match, so the row states that the question
    does not apply. Where an R figure would otherwise appear, the reason given is that no planned
    risk was defined — not that a risk is missing.

    **Target semantics are unchanged.** Fixed Target with a Defined Risk gives a known Planned RR.
    No Fixed Target with a Defined Risk and an Exit Plan is a complete, valid plan whose RR is not
    knowable at entry and which stays eligible for later rule-based System-vs-Trader evaluation.
    No Fixed Target without a usable Exit Plan resolves no planned System result under this model.
    The System-result questionnaire is **not** part of this decision.

    **Stop Method (decision 53) is withdrawn from capture.** It has no UI, no new value is ever
    written, and nothing is inferred from the values already stored, which remain valid history.
    `planned_stop_method` and migration 0029 stay in place; the column is simply no longer fed.

    **Price still decides nothing.** `context_stop_price` neither creates a Defined Risk nor proves
    the absence of one; Money remains the authoritative representation (§3).

    **Nothing historical changes.** No row is backfilled or reinterpreted. A draft written before
    this decision carries only the amount the trader typed, and is read from exactly that: an
    amount means Defined, a blank means Unanswered, and No Defined Risk is never invented for it.
    Amends §2, §4 and §5; refines §23. (§2, §4, §5, §23)

Recording order and the Plan Outcome, 2026-09-24 (item 55):

55. **One capture order, and a factual Plan Outcome in After Trade** — Record Open Trade and Record
    Closed Trade now share one canonical order for the stages they have in common: Trade, Risk &
    target, Strategy & setup, Entry context. Record Closed continues with Trader result and After
    trade; the earlier Result-first order is retired. Close Existing Open Trade still begins at
    Trader result, with stages 1–4 as read-only context. Step labels are those six words in every
    flow.

    **Trader Result** is what the trader actually did: final exit time, Final Net P&L, Trader
    Outcome, exit history, and Trader R = Final Net P&L ÷ Risk at Entry only when a Defined Risk
    exists. With No Defined Risk or Unanswered risk the P&L stands and no R is fabricated.

    **After Trade begins with a System Result: the Plan Outcome** — what the original plan would
    have produced. The recorded plan decides the question; only the trader's answer decides the
    outcome:

    - **Defined Risk + Fixed Target (bounded).** "What happened first under the original plan?" —
      Planned target / Planned risk / Can't determine. Planned target first is the Target Profit
      and Target Profit ÷ Risk at Entry; planned risk first is −Risk at Entry and exactly −1R. The
      trader is not asked for a number the plan already gives. A Fixed Target recorded only as a
      TP price has no money figure, and Price never calculates a result (§3), so target-first
      states its amount.
    - **Defined Risk + a rule-based Exit Plan, without a Fixed Target.** The Exit Plan is shown
      read-only; "If you followed this Exit Plan, what result would it have produced?" takes a
      stated amount (System R = amount ÷ Risk at Entry) or Can't determine.
    - **No Defined Risk**, or no Risk at Entry on record: no R comparison exists and nothing is
      asked; the reason is said plainly. No denominator is ever invented.
    - **Defined Risk with neither a Fixed Target nor a usable Exit Plan:** no plan outcome exists
      to establish, and none is fabricated.

    Every answer is optional, and Unanswered is not Can't determine. A Trade closed now may not be
    able to answer yet, so After Trade may be skipped and revisited from the Trade; Closed never
    depends on it.

    **A Plan Outcome is capture evidence, not a System Assessment.** It is stored on the Trade
    (`plan_outcome`, migration 0032) with its provenance — target first, risk first, an Exit Plan
    result, or Can't determine — and never in `trade_system_assessments`. It carries no Net / Gross
    claim; Review's System Assessment may read it later and keeps its own confirmation,
    comparability, provenance and staleness semantics (Review & System Assessment contract, not
    amended). Target-first and risk-first amounts are derived from the plan when read, so a later
    correction of Risk at Entry or Target never leaves a stale copy; only a stated amount is
    stored. An answer the plan no longer offers after such a correction is shown as needing the
    trader's answer again, never silently dropped or re-derived. Never inferred from Final Net P&L,
    the Trader Outcome, exit legs or price.

    **Review stays separate.** Mistakes, rule checks, Exit Plan Adherence, reflection and System
    Assessment remain post-save Review; none moves into After Trade.

    **Nothing historical changes.** Every existing Trade's Plan Outcome is Unanswered; nothing is
    backfilled. Drafts written before this decision hold no Plan Outcome and load with it
    Unanswered. Amends the Recording lifecycle and §13; adds to §9. (§9, §13, Recording
    lifecycle)

Actual Risk retired from capture, 2026-09-25 (item 56):

56. **Actual Risk is retired from canonical capture. Step 2 Risk is the single user-defined 1R
    basis for Trader / System R comparisons.** TradeChemist V1 records one Risk per Trade — the
    amount the trader defines as 1R, in Plan & Risk (Risk & target). The core model is Risk (1R),
    Trader Result (what the trader actually made or lost) and System Result (what the original
    plan would have produced).

    **Nothing asks for a second risk figure.** Entry Context & Evidence (Step 4) no longer asks
    Actual Risk in Record Open or Record Closed — no row, no Matched / Different / amount-unknown
    interaction, no "not applicable" state — and Plan & Risk never did after decision 53. The
    product does not teach separate concepts of planned, actual or execution risk; internal names
    such as `planned_risk_minor` stay as they are.

    **R uses Risk alone.** Trader R = Final Net P&L ÷ Risk; System R = System Result ÷ Risk. No
    Defined Risk (decision 54) produces no Trader R, System R or Planned RR. Risk is never derived
    from Entry, SL or size (§3).

    **History is kept, not reinterpreted.** No column or table is dropped, and nothing is
    backfilled. `actual_risk_answer` and `actual_initial_risk_minor` on Trades recorded before this
    decision stay exactly as saved, are shown read-only only where a Trade has one, and never
    affect Trader R, System R, Planned RR or new canonical analytics. Legacy (pre-contract) rows
    keep their own historical Actual R rules (§28). A browser draft that still holds an Actual
    Risk answer — any draft version — has it discarded on load, so it can never reach a new Trade;
    nothing replaces it.

    Supersedes the capture placement of decisions 51–53 and the Actual Risk interaction of
    decision 52 for new recordings; their text remains the meaning of the historical data they
    produced. (§4, Recording lifecycle, §23)

One closing model for Record Closed, 2026-09-25 (item 57):

57. **Record Closed derives the whole-Trade result from how the Trade closed. There is one result
    source.** Step 5 (Trader Result) records how the Trade actually closed; the Final Net P&L is
    what that close adds up to, never a second figure typed beside it.

    **Outcome first, then the close.** Trader Outcome stays first and separate (§12) — never
    derived from the result. The Trade result then asks _How did you close this trade?_:

    - **Closed all at once** — one All remaining exit. The trader records its P&L (and optionally
      its price and reason); that P&L **is** the Final Net P&L.
    - **Closed in parts** — a sequence of exit legs, each with the existing fields (Part / All
      remaining / Don't know, P&L, % of original position, exit time, price as context, reason).

    **The sequence says when it is closed.** The exits prove the whole position closed only when
    an All remaining exit closes what was left, or their stated percentages total 100%. Until then
    the close is partial: its status shows the share accounted for and what remains, or that the
    allocation is unknown when an exit states no share — never an estimate — and there is **no
    Final Net P&L**: at most a running figure labelled _recorded so far_. Once closed and every exit
    states its P&L, Final Net P&L = the sum of the exit P&Ls, and Trader R = Final Net P&L ÷ Risk
    (decision 56; No Defined Risk gives no R). Price never calculates P&L (§3).

    **No close type is persisted.** The exit records say it: one All remaining exit is a full
    close. A Save sends the exits, `exit_history_completeness = 'complete'` exactly when the exits
    prove the close, and the derived Final Net P&L as adopted from the exits, which the service
    re-checks and stores with `final_pnl_source = 'exit_history'` (no schema change). The separate
    editable Final Net P&L field, "Use recorded exits as final result", the explicit exit-history
    completeness question and the subtotal-vs-Final-P&L discrepancy notice are withdrawn from
    Record Closed — they existed only because two result sources did.

    **Server enforcement** of the single source is decision 58.

    **Scope.** This amends §11 for **new Record Closed capture** only. Close Existing Open Trade
    (the canonical Final Close, `recordContractExit`) keeps its stated Final Net P&L for All
    Remaining until explicitly migrated. Saved Trades are untouched: a Trade recorded with a manual
    Final Net P&L (`final_pnl_source = 'manual_total'`) keeps it, its exits stay supporting
    history, and the saved-record correction and adoption paths still apply to it. A browser draft
    written before this decision is read once: its exits become a close in parts; a typed Final Net
    P&L with no exits becomes a full close with that P&L; a typed Final Net P&L beside exits is not
    kept. Amends §11 and §13. (§11, §13, Recording lifecycle)

One result authority per Record Closed Trade, 2026-09-25 (item 58):

58. **A new Record Closed Trade has exactly one result authority, and the server enforces it.**
    Decision 57 stands; this completes it.

    **Closed in parts, only the final result known.** A trader may know the Trade closed in parts
    and its final net result without knowing each exit's P&L. _Closed in parts_ therefore asks
    _How do you want to record the result?_:

    - **Record each exit** — decision 57's exit-derived flow: legs, allocation status, and Final
      Net P&L = the sum of the exits once they prove the close and every exit states its P&L
      (`final_pnl_source = 'exit_history'`).
    - **I only know the final result** — one Final Net P&L input (_Use this when you know the final
      result but not each exit separately._). No exit is made up, no allocation is asked or
      warned about, Trader R = Final Net P&L ÷ Risk, and the result is stored as the trader's own
      (`final_pnl_source = 'manual_total'`).

    The three authorities — a full close's P&L, an exit-derived partial result, a stated total for
    a close in parts — are mutually exclusive. Only the chosen way is shown and saved; switching
    keeps each way's answers in the draft but never saves two. A draft keeps the chosen way through
    a reload; a draft written before this decision is read without choosing one for the trader
    (exits alone were recorded exit by exit; exits beside a typed total, or a typed total alone,
    keep every value and leave the way Unanswered).

    **The server refuses a bypass.** A Record Closed Save's Final Net P&L must carry exactly one
    claim: `finalPnlAdoptedFromExits` (re-checked: history Complete, the exits prove the close —
    an All remaining exit or shares totalling 100% — every exit has P&L, and the sum equals the
    figure) or `finalPnlStatedTotal` (refused beside exits that prove the close with every P&L
    known, since those already give a result). A bare figure, both claims, or a claim without a
    figure is refused (`final_pnl_source_invalid`, or `exit_history_not_adoptable`) and nothing is
    written. This replaces decision 57's note that the service accepted a bare stated figure.

    **Unchanged.** Close Existing Open Trade (the canonical Final Close) keeps its stated Final Net
    P&L for All Remaining. Saved Trades are read as stored — a manual total beside disagreeing
    exits included — and keep the saved-record correction and adoption paths. No schema change.
    Amends §11 and §13. (§11, §13)
