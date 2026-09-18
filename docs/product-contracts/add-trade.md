# TradeChemist — Add Trade Product Contract v1

> **Status: Approved (v1, 2026-09-14).** This document is the product source of truth for the
> TradeChemist Add Trade domain: At Entry, After Trade, Partial / Final Close, Review, System
> Assessment, and the related Strategy, Psychology and Discipline semantics. Review decisions 1–11,
> final decisions 12–18, closing decisions 19–21, analytics decisions 22–23 and UX boundary
> decisions 24–37 and pre-design decisions 38–40 are recorded in the [Decision log](#decision-log).
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

**Actual Risk** — optional
ความเสี่ยงทางการเงินจริงของ position เมื่อ execution ทำให้ต่างจาก Risk at Entry

Actual Risk **ไม่** เปลี่ยนนิยามของ Actual R ใช้สำหรับ Risk Discipline / Risk Deviation analytics

UX ต้องไม่บังคับให้กรอกสองค่าทุกครั้ง

กรณีทั่วไปควรเรียบง่าย เช่น:

Risk at Entry = $50

แล้วเปิด progressive action เช่น:

Actual risk differed

เพื่อบันทึก Actual Risk เฉพาะเมื่อจำเป็น

## Actual Risk at Entry

การไม่เปิด `Actual risk differed` หมายถึง trader ยืนยันว่า actual risk ตรงกับ Risk at Entry ที่บันทึก

interaction ต้องสื่อความหมายนี้อย่างซื่อสัตย์ ห้ามเป็น hidden server inference

ถ้า trader เปิด `Actual risk differed` อย่าง explicit แต่ไม่กรอกจำนวน ให้เก็บเป็น **Different** และ **amount unknown** ห้าม revert เป็น Matched เงียบ ๆ

## Known Risk at Entry

Risk at Entry ที่ทราบค่าต้องมากกว่าศูนย์

ศูนย์ไม่ใช่ตัวแทนของ risk ที่ unknown หรือไม่ได้บันทึก

## Actual Risk in After Trade

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
- Not Applicable — เฉพาะเมื่อ Trade มี Exit Plan เป็น `No Defined Exit Rule` อย่าง explicit
- Not Answered

ถ้า Exit Plan เป็นเพียง `Not recorded` ห้าม infer `Not Applicable` adherence ยังคงเป็น Not Answered จนกว่า trader จะตอบ

แสดงได้ทั้งใน Discipline และ System Assessment แต่ห้ามเก็บเป็นคำตอบซ้ำสองชุด

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

- What happened?
- What would you repeat?
- What would you change?

`Reviewed — nothing else to add` เป็น valid completion

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
- **implicit Actual Risk** ที่ตรงกับ Risk at Entry ("matches") ห้าม carry เป็น confirmed answer — After Trade Actual Risk เริ่มต้นเป็น Unanswered (ดู §4)
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

Actual risk ยืนยันว่าตรง ≠ Actual Risk unknown (Don't know) ≠ Actual Risk unanswered

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
- gross-only result ที่ไม่ eligible สำหรับ canonical comparable metric
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
    reconfirmed, ineligible gross-only results and legacy results, with coverage reported honestly.
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
