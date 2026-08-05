# Glossary — normative vocabulary

This project uses the **Chatburn taxonomy for modes of mechanical ventilation**
and the **Mireles-Cabodevila taxonomy for patient–ventilator interactions**.
Both are standard, both are published, and both exist because the field's
everyday vocabulary is ambiguous enough to make research and teaching unreliable.

**This document is normative.** Code identifiers, UI copy, teaching text, ticket
language and commit messages follow it. Adding a term means adding it here with
a citation, in the same PR.

Source keys used below:

| Key | Source |
| --- | --- |
| **C2007** | Chatburn RL. Classification of ventilator modes: update and proposal for implementation. *Respir Care* 2007;52(3):301–323 |
| **C2023** | Chatburn RL. The complexities of mechanical ventilation: toppling the tower of Babel. *Respir Care* 2023;68(6):796–820 |
| **C2026** | Chatburn RL. How to interpret ventilator waveforms using the taxonomy for modes of mechanical ventilation. *Respir Care* 2026 |
| **FUND** | Chatburn RL. *Fundamentals of Mechanical Ventilation.* Mandu Press |
| **MC2022** | Mireles-Cabodevila E, Siuba MT, Chatburn RL. A taxonomy for patient-ventilator interactions and a method to read ventilator waveforms. *Respir Care* 2022;67(1):129–148 |
| **MC2026** | Mireles-Cabodevila E, Vaporidi K, Blanch L, Chatburn RL. Defining and measuring patient–ventilator interactions: 10 fundamental maxims. *Respir Care* 2026 |
| **MC2024** | Mireles-Cabodevila E, Catullo K, Chatburn RL. Simulation in mechanical ventilation training. *Respir Care* 2024;69(11):1468–1476 |
| **H2014** | Hess DR. Respiratory mechanics in mechanically ventilated patients. *Respir Care* 2014;59(11):1773 |

---

## 1. Naming a mode — the TAG

A mode is classified, not branded. The classification is a **TAG** (taxonomic
attribute grouping) built from three things (C2023, Maxim 10):

1. **Control variable** — `VC` or `PC`
2. **Breath sequence** — `CMV`, `IMV`, or `CSV`
3. **Targeting scheme(s)** — `s d r a b o i`

```
<CV>-<SEQ>[(imvType)]<primaryTargeting>[,<secondaryTargeting>]
```

Everything this simulator implements is set-point targeting, so the TAGs in use
are `VC-CMV`, `PC-CMV`, `PC-CSV` — strictly `VC-CMVs`, `PC-CMVs`, `PC-CSVs`.

**Brand names are display labels, never types.** 495 brand names across 55
ventilators reduce to 74 unique TAGs (C2026). PRVC is widely believed to be a
volume mode; it is `PC-CMVa`. Keep vendor names in a lookup table keyed by TAG,
and never branch on one.

> "We must distinguish mode names (ie, brand names invented by manufacturers for
> marketing purposes) from mode classifications for the same reasons we must
> distinguish drug brand names from generic names." — C2023, Maxim 10

### Targeting schemes (C2023, Table 4)

| Symbol | Scheme | Definition | Example |
| --- | --- | --- | --- |
| `s` | Set-point | Operator sets all parameters of the volume and flow waveforms | Volume or Pressure A/C |
| `d` | Dual | Ventilator switches between VC and PC **within** a single inspiration | VC on Servo |
| `r` | Servo | Inspiratory pressure proportional to inspiratory effort | NAVA, PAV, ATC |
| `a` | Adaptive | Inspiratory pressure auto-adjusted between breaths to hit a VT target | PRVC |
| `b` | Bio-variable | Inspiratory pressure varied randomly within an operator-set distribution | Variable PS |
| `o` | Optimal | Ventilator adjusts rate and VT to minimise power transfer | ASV |
| `i` | Intelligent | AI/rule-based target setting | SmartCare |

⚠️ `s` is **set-point**, `r` is **servo**. Do not use `s` for servo.

---

## 2. The five ventilatory patterns

Control variable × breath sequence (C2023, Maxim 8):

**`VC-CMV` · `VC-IMV` · `PC-CMV` · `PC-IMV` · `PC-CSV`**

**`VC-CSV` is impossible** — volume control means the ventilator determines VT;
a spontaneous breath means the patient does (C2007 §1a). Assert this in code.

> Note: C2023 Maxim 8 contains a typo here, printing "VC-CMV is not possible."
> C2007 states it correctly. It is VC-CSV.

---

## 3. Phase variables

| Term | Definition | Source |
| --- | --- | --- |
| **Trigger** | To **start** inspiration. The trigger event is the start of positive flow. | C2007; C2023 Maxim 4 |
| **Cycle** | To **end** inspiration and begin expiratory flow. | C2007; C2023 Maxim 4 |
| **Limit** | To restrict the magnitude of pressure, volume or flow to a preset value. A limit variable **can be reached and maintained before inspiration ends but does not end inspiration.** | C2007 |
| **Baseline** | The variable controlled during expiration — always pressure, in practice PEEP. | FUND Ch.3 |
| **Sensitivity** | The threshold value the trigger variable must reach to start inspiration. **A high threshold = a low sensitivity.** | C2007; C2023 Maxim 4 |

### ⚠️ The limit/cycle conflation — the canonical error

> "Clinicians often confuse limit variables with cycle variables. To cycle means
> to end inspiration. A cycle variable always ends inspiration. A limit variable
> does not terminate inspiration; it only sets an upper bound." — FUND Ch.3

**Time can never be a limit variable** — limiting inspiratory time would end
inspiration, which is cycling.

An alarm threshold that terminates inspiration is a **backup cycling
mechanism**, not a limit. Manufacturers call these "limits"; we do not.

### Trigger and cycle agents (C2023, Maxim 5)

|  | Machine | Patient |
| --- | --- | --- |
| **Trigger** | time | pressure, flow, volume, EAdi, chest-wall motion |
| **Cycle** | time, volume | pressure, **flow** |

Flow cycling **is** patient cycling — the rate of flow decay to threshold is set
by the patient's mechanics and effort.

A passive patient can both trigger and cycle inspiration purely through
resistance and compliance. "Patient-triggered" does not imply effort was
required.

---

## 4. Breath types — exactly two

> **Spontaneous breath**: the patient both **triggers and cycles** inspiration.
> **Mandatory breath**: the ventilator triggers **and/or** cycles the breath.
> A mandatory breath is, by definition, assisted. — C2023, Maxim 6

Boolean form: `spontaneous ⟺ (triggerAgent === 'patient' && cycleAgent === 'patient')`.

The taxonomy deliberately has no third name for patient-triggered /
machine-cycled breaths — those are mandatory.

### "Assisted" does not mean "patient-triggered"

> "A breath (ie, the patient) is 'assisted' if the ventilator does some portion
> of the work of breathing. This is observed as airway pressure rising above
> baseline (PEEP) during TI. A breath is **loaded** if the patient does some work
> on the ventilator system — airway pressure falling below baseline during
> inspiration. A common misconception is that an assisted breath is any
> patient-triggered breath, which is obviously not true for demand-valve CPAP."
> — C2023, Maxim 2

---

## 5. Breath sequences

| Sequence | Definition (C2023, Maxim 7) |
| --- | --- |
| **CMV** | Spontaneous breaths are **not possible** between mandatory breaths — every patient trigger produces a machine-cycled inspiration. |
| **IMV** | Spontaneous breaths **are** possible between mandatory breaths. |
| **CSV** | All breaths are spontaneous. |

**Rate semantics differ, and this matters to the engine:**

- **CMV** — the set frequency is a **minimum**. Actual mandatory rate may exceed
  it (every patient trigger yields a mandatory breath) but never falls below.
- **IMV** — the set frequency is a **maximum**; spontaneous breaths may suppress
  mandatory ones, depending on IMV type (1–4, with a 5th now described).

"SIMV" is an anachronism as a sequence name — patient triggering is specified at
the phase-variable level, not by prefixing an S (C2007 §1b). "Assist/Control"
maps to CMV but is deprecated as a type: it says only that a breath may be
machine- or patient-triggered, which no longer distinguishes anything (C2007).

---

## 6. The equation of motion

```
Pvent(t) + Pmus(t) = E · V(t) + R · V̇(t) + PEEPauto
```

| Symbol | Meaning | Unit | Reference frame |
| --- | --- | --- | --- |
| `Pvent` | pressure generated by the ventilator | cmH₂O | **relative to PEEP** |
| `Pmus` | pressure generated by the ventilatory muscles | cmH₂O | **+ inspiratory, − expiratory** |
| `Paw` | airway opening pressure | cmH₂O | gauge |
| `V` | volume | L | above end-expiratory lung volume |
| `V̇` | flow | L/s | **+ = inspiration** |
| `E` | elastance = 1/C | cmH₂O/L | |
| `C` | compliance | L/cmH₂O | |
| `R` | resistance | cmH₂O·s/L | |
| `τ` | time constant = R·C | s | |

**Determining the control variable** (C2023, Maxim 3):

- **VC means both volume and flow are preset.** Setting a VT target is necessary
  but *not sufficient* — adaptive PC modes also let you set a VT target.
- **PC means inspiratory pressure as a function of time is preset.**

Operational test: change the load. PIP constant, VT varies → pressure control.
VT constant, PIP varies → volume control.

**Expiration is always pressure-controlled** at PEEP (MC2022).

### The reading rule

> "When assessing load or patient-ventilator interactions, attention should be
> focused to the waveform **opposite the control variable.**" — MC2022, Step 2

In VC, read pressure. In PC, read flow and volume.

---

## 7. Patient–ventilator interaction

### Umbrella terms

| Term | Definition | Source |
| --- | --- | --- |
| **Synchrony** | Near-zero phase difference between patient signal and ventilator response | MC2022 |
| **Asynchrony** | Absence of a ventilator response to a patient signal, or vice versa | MC2022 |
| **Dyssynchrony** | A clinically important phase difference | MC2022 |
| **Discordance** | **All** mismatches between patient and ventilator signals — timing **and** magnitude | MC2026 |

Asynchrony and dyssynchrony describe timing alone. **Use "discordance" as the
umbrella noun**; reserve "asynchrony" for the literature-facing Asynchrony Index.

### Phase difference convention (MC2026, Maxim 5)

```
Δt = t_vent − t_mus

Δt < 0  →  ventilator leads  →  EARLY
Δt > 0  →  ventilator lags   →  LATE
Δt = 0  →  synchrony
```

### Trigger-phase discordances (MC2026, Table 3)

| Canonical term | Definition | Deprecated aliases |
| --- | --- | --- |
| **Early trigger** | Machine-triggered breath where Pvent begins early relative to Pmus | reverse trigger, premature trigger |
| **Late trigger** | Patient-triggered breath where Pvent lags the onset of Pmus | trigger delay |
| **Failed trigger** | **Pmus present, no Pvent.** Phase difference undefined. | ineffective trigger/effort, missed trigger, wasted effort |
| **False trigger** | **Pvent present, no Pmus.** Phase difference undefined. | auto-trigger, auto-cycling |

Causes of a **failed trigger**, all worth teaching: auto-PEEP (Pmus must exceed
it before flow can be positive), **over-assistance**, high trigger threshold,
weak effort or low drive.

> ⚠️ Documented dissent: Piraino argues "failed trigger" pushes clinicians to
> reach for the sensitivity knob when the cause is over-support, and teaches
> "ineffective effort" instead. Canonical term here remains **failed trigger** —
> and UI copy names the cause alongside the label so the reflex is defused.

### Inspiratory-phase — work shifting

> "When Pvent and Pmus are active together, some portion of the total work is
> done by the ventilator and some by the patient. We call this **work
> shifting**." — MC2022

**Severe work shifting** = inspiratory pressure drops below baseline (PEEP). The
patient is doing work *on the ventilator*. Never appropriate.

Work shifting is not inherently abnormal and may be intentional. What is
abnormal is **over-assistance** (Pvent exceeds the level appropriate to the
goal, suppressing drive) and **under-assistance** (the patient carries more than
intended).

> ⚠️ **"Air hunger", "flow asynchrony", "flow starvation" are deprecated.** They
> "conflate patient sensation, ventilator timing, and flow delivery." These are
> manifestations of work shifting, reflecting **under-assistance rather than
> timing errors** (MC2026, Maxim 8).

How work shifting appears, by targeting scheme — this governs rendering:

| Targeting | Pvent as Pmus ↑ | Total work | Signature |
| --- | --- | --- | --- |
| VC set-point | ↓ (inverse) | constant | **pressure scooping**; below PEEP = severe |
| PC set-point | constant | ↑ (larger VT) | flow/VT exceed passive; flow decay deviates from exponential |
| PC adaptive | ↓ toward PEEP | varies | VT above target with falling Pvent |
| PC servo | ↑ proportionally | ↑ | work shifting minimised |

**Work Shifting Index** (MC2026, Maxim 9): `WSI = (Wpt / Wtot) × 100`.
0% = ventilator does everything; 100% = patient does everything; **>100% = loaded
breaths**. The paper explicitly notes this metric "may be most useful with
simulations."

### Cycle phase

- **Early cycle** — Pvent cycles before Pmus ends. Signature: early expiratory
  flow deviates toward baseline.
- **Late cycle** — Pvent continues after Pmus ends. Signature: end-inspiratory
  flow at zero, with or without a pressure rise.

Nuance worth teaching: a short trigger effort on a time- or volume-cycled breath
is *by definition* late cycling and may be perfectly acceptable. It matters when
there is expiratory effort before the cycle event.

### Expiration — four states (MC2026, Maxim 10)

**Passive** (recoil only) · **active** (Pmus < 0) · **assisted** (Pvent
intentionally below PEEP) · **controlled** (ventilator regulates expiratory flow).

### Patterns

**Multiple triggering** — two or more assisted breaths from a single persistent
effort or trigger signal. Preferred over "double triggering", which is imprecise
because more than two can occur. Causes: early cycle, early trigger, false
trigger.

**Breath-stacking** is a *consequence* of multiple triggering, not a synonym:
inspiratory volume delivered before the previous breath is fully exhaled,
summing VTs.

**Cluster** — multiple discordance events in close succession; associated with
longer ventilation and worse outcomes. Example operational definition: >6
double-trigger events within 3 minutes.

### Asynchrony Index (MC2026)

```
AI = (asynchronous breaths / total respiratory efforts) × 100
```

> "An AI >10% is commonly cited as clinically important, but this threshold is
> arbitrary, varies with which discordances are counted, and remains highly
> context-dependent."

State the counting convention: **all-inclusive** (every discordant feature) vs
**first-event only** (the initiating discordance). MC2022 recommends first-event
clinically, since discordances cascade.

Other published numbers — encode these as named, cited constants, never as bare
magic numbers:

| Threshold | Value |
| --- | --- |
| AI clinically important | >10% (explicitly called arbitrary) |
| Normal trigger response | within 100 ms |
| Late trigger | Pmus evidence >100 ms before inspiratory flow |
| Cluster (double trigger) | >6 events within 3 min |

> "There is no standardized latency threshold to determine a 'late' trigger."

### Reference signal must always be named

Pmus cannot be measured directly. Surrogates, descending fidelity: **EAdi**,
**esophageal pressure**, RIP belts, **airway flow and pressure**. EAdi precedes
Pmus, which precedes flow — so `TI-neural ≠ TI-vent`, and any timestamp must
carry which signal it came from (MC2026, Maxim 2).

---

## 8. The three-step reading method (MC2022, Table 4)

The schema for teaching-mode prompts and assessment items:

1. **Define the TAG** — which mode is this?
2. **Define the load** — elastic / resistive / Pmus, for inspiration and
   expiration separately.
3. **Define the PVI** — trigger (normal/early/late/false/failed) · inspiration
   (normal / work shifting / severe work shifting) · cycle (normal/early/late) ·
   expiration (normal / expiratory work).
4. **Intervention** — pick **one** goal, then settings change / mode change / none.

Output is one sentence: *"The patient is on PC-CMVa, with a high elastic load
and has early triggers."*

**Only three goals of ventilation**, and only one is primary at a time (C2023):
**safety** (gas exchange, minimise VILI) · **comfort** (synchrony, appropriate
work distribution) · **liberation** (minimise duration and adverse events).

Guardrails to encode:

> "If the patient is paralyzed/deeply sedated and there is no Pmus, then by
> definition there can't be an issue with synchrony: it is a matter of operator
> settings choice." — MC2022
>
> "Not every interaction requires an intervention." — MC2022

---

## 9. Do / Don't

| Concept | Use | Not |
| --- | --- | --- |
| Mode identity | **TAG** (`PC-CSV`); brand name as a label only | brand name as a type |
| Control variable | **VC**, **PC** | "volume mode", "volume-cycled" as a mode name |
| Breath sequence | **CMV**, **IMV(n)**, **CSV** | "A/C", "SIMV", "spont" as sequence types |
| Breath type | **mandatory**, **spontaneous** | "assisted breath", "control breath" as types |
| Trigger agent | **machine-triggered**, **patient-triggered** | "assisted" to mean patient-triggered |
| Phase variables | **trigger, limit, cycle, baseline** | "limit" for a terminating alarm |
| Terminating alarm | **backup cycling mechanism** | "pressure limit" |
| Effort/support mismatch | **work shifting**, **over-/under-assistance** | flow starvation, flow asynchrony, air hunger |
| Effort not sensed | **failed trigger** | ineffective effort, missed trigger, wasted effort |
| Breath with no effort | **false trigger** | auto-trigger, auto-cycling |
| Repeated breaths, one effort | **multiple triggering** | double triggering |
| Summed VT | **breath-stacking** (a consequence) | as a synonym for multiple triggering |
| All mismatches | **discordance** | asynchrony used loosely |
| VT/(PIP−PEEP) | **dynamic characteristic** | "dynamic compliance" |
| VT/C | **tidal pressure**, computed from PEEPtot | "driving pressure" from set PEEP |
| Adaptive VT targeting | **adaptive targeting** (`a`) | "dual control" — that means *within-breath* VC↔PC |

**Name discordances by signal, not etiology.**

> "By using descriptive terms based on signal analysis rather than etiology, we
> intend to avoid ambiguity when reporting. By eliminating the cause from the
> name, we allow the nomenclature to remain valid as we discover other causes."
> — MC2022, Step 3

Preferred compound form: *"early trigger due to reverse trigger."*

### ⚠️ One open exception: "ineffective effort" in the UI

The engine is compliant — `type: 'failed'`, `gateFailed`, `_recordFailedTrigger`.
**The learner-facing copy is not.** `INEFFECTIVE_WINDOW_SEC`,
`countIneffectiveEfforts()`, the `Ineffective N /60s` counter, and both
failed-effort tooltips all say "ineffective effort", which this table lists in
the **Not** column.

This is unresolved, not an oversight, and it is a Red-lane call: "ineffective
effort" is the phrase working RTs recognise, and the dissent recorded above is
about exactly this word. Two defensible outcomes:

1. **Rename the UI** to "failed trigger" and teach the taxonomy term.
2. **Keep "ineffective effort"** as a deliberate, documented exception — the
   learner meets the familiar phrase first, with the canonical term alongside it.

Until the owner decides, do not silently change either the copy or this table.

---

## 10. Suggested code conventions

```js
/** @typedef {'VC'|'PC'} ControlVariable */
/** @typedef {'CMV'|'IMV'|'CSV'} BreathSequence */
/** @typedef {'s'|'d'|'r'|'a'|'b'|'o'|'i'} TargetingScheme */
/** @typedef {'mandatory'|'spontaneous'} BreathType */
/** @typedef {'machine'|'patient'} Agent */
/** @typedef {'trigger'|'inspiration'|'cycle'|'expiration'|'pattern'} DiscordancePhase */
/** @typedef {'earlyTrigger'|'lateTrigger'|'failedTrigger'|'falseTrigger'
 *           |'overAssistance'|'underAssistance'
 *           |'earlyCycle'|'lateCycle'
 *           |'activeExpiration'
 *           |'multipleTriggering'|'cluster'} Discordance */
```

Invariants worth asserting in the engine:

- `breathType === 'spontaneous'` **iff** patient-triggered **and** patient-cycled
- `VC && CSV` is unreachable
- `mandatory ⇒ assisted`
- `CMV` ⇒ set rate is a **floor**; `IMV` ⇒ set rate is a **ceiling**
- `Pmus > 0` = inspiratory effort; positive flow = inspiration
- expiration is pressure-controlled at PEEP
- discordance records carry an explicit `referenceSignal`
- `Δt = tVent − tMus`; negative = early

---

## 11. Known errata in the source literature

Recorded so contributors don't propagate them.

1. **C2023 Maxim 8** prints "VC-CMV is not possible"; it should read **VC-CSV**.
   C2007 §1a is correct.
2. **MC2022 Fig 1 legend** (as printed) shows `S` for both set-point and servo.
   Canonical: `s` = set-point, `r` = servo (C2023 Table 4).
3. **MC2022's units of the equation of motion** mix mL with L/min, which is
   dimensionally inconsistent. Use cmH₂O, L, L/s, cmH₂O/L, cmH₂O·s/L.
4. **IMV types now number five.** C2023 defines IMV(1)–(4); C2026 references
   IMV(5). Type the field as an integer, not a 1–4 union.
5. **Pressure support is described two ways** — "flow-cycled" (C2007) and
   "patient-cycled" (FUND). These agree, since flow cycling *is* patient
   cycling, but the phrasings look contradictory.

---

## 12. A gap this simulator can fill

> Chatburn, on the early-cycle → multiple-trigger → VT overdose sequence: "that's
> not displayed because **the display resets every time flow crosses zero.** So
> if you don't recognize the pattern on the flow and the pressure waveform and if
> you just look at the digital display or the volume waveform, you don't realize
> how dangerous the situation is."
>
> Mireles-Cabodevila: "Of all the discordances that could be signaled by the
> ventilator, this seems to me to be one that they could potentially just alert
> us and say, **'2 breaths occurred too close together.'**" — MC2026, Panel

Real ventilators do not alarm on discordance, and their displays actively hide
summed volume. A teaching simulator can do both.
