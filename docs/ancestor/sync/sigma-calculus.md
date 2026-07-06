# Σ-calculus

## A Minimal Algebra of Substrate Systems

---

## Motivation

The λ-calculus captures computation with three forms (variable, abstraction, application) and one reduction rule (β-reduction). Every computable function can be expressed in this algebra. The question: is there an equivalently minimal calculus for *emergent* systems — systems where behavior arises from self-activating observers of shared truth rather than from sequential function application?

The substrate thesis proposes that software is a shared substrate of truth observed by self-activating components. Three projects (ctxl, sync, playtest) instantiate this claim. This document attempts to distill the common algebraic structure underneath all three into a formal calculus — the **Σ-calculus** (sigma-calculus, for substrate).

### Design Goals

1. **Minimality.** The fewest primitives that capture substrate dynamics. Every primitive must be necessary; removing any one should make at least one key property unexpressable.

2. **Compositionality.** The algebra must support parallel composition where adding components does not require modifying existing ones.

3. **Decidable activation.** It must be statically determinable which components *can* activate in a given state, even if the order of activation is not determined.

4. **Monotonicity distinction.** The algebra must structurally distinguish monotonic operations (which require no coordination) from non-monotonic operations (which do), making the CALM boundary visible in the syntax.

5. **Lean-provable.** Every definition should translate directly to inductive types and propositions in Lean 4.

---

## 1. The Substrate

A substrate is a finite partial function from *located keys* to *values*.

```
Key   := String
Scope := String
Val   := JSON-like atoms (we abstract over this)

Loc   := Scope × Key

Σ     := Loc →fin Val
```

A located key `(s, k)` identifies a fact. The scope `s` provides authority boundaries. The substrate `Σ` is the totality of situated facts at a moment.

We write `Σ(s, k) = v` to mean key `k` in scope `s` holds value `v`, and `Σ(s, k) = ⊥` to mean the fact is absent.

### Versioning

Each located key carries a version number:

```
ΣV := Loc →fin (Val × ℕ)
```

We elide versions when not needed and introduce them explicitly for non-monotonic operations.

---

## 2. Predicates

A **predicate** is a decidable proposition over the substrate:

```
φ : Σ → Bool
```

Predicates are the activation conditions. They determine when a component becomes relevant. In sync, these are CEL expressions. In the calculus, we treat them abstractly but require decidability — given any finite substrate, the predicate terminates and returns true or false.

### Predicate Algebra

Predicates form a Boolean algebra under the usual operations:

```
⊤        : Σ → true                    (always active)
⊥        : Σ → false                   (never active)
¬φ       : Σ → ¬(φ(Σ))                 (negation)
φ₁ ∧ φ₂  : Σ → φ₁(Σ) ∧ φ₂(Σ)          (conjunction)
φ₁ ∨ φ₂  : Σ → φ₁(Σ) ∨ φ₂(Σ)          (disjunction)
```

A predicate is **monotone** if, for all Σ ⊆ Σ' (where ⊆ means Σ' agrees with Σ on all defined keys and may define additional ones):

```
φ(Σ) = true  →  φ(Σ') = true
```

Once a monotone predicate becomes true, it stays true as the substrate grows. This is the CALM boundary expressed in the predicate algebra.

A predicate is **anti-monotone** if:

```
φ(Σ) = true  →  φ(Σ') = true   when Σ' ⊆ Σ
```

Anti-monotone predicates respond to absence. They are the source of coordination requirements.

---

## 3. Terms

The Σ-calculus has five term forms. This is the complete syntax.

```
e ::= fact(s, k, v)                    -- a situated fact
    | write(φ, s, W)                   -- a guarded write 
    | observe(φ, s, R)                 -- a guarded observation
    | e ∥ e                            -- parallel composition
    | scope(s, e)                      -- authority boundary
```

Where:

- `W : Σ → Loc →fin Val` is a **write function** — given the current substrate, it produces a set of located writes.
- `R : Σ → Out` is a **read function** — given the current substrate, it produces an output (an affordance, a rendered surface, an API response). `Out` is abstract.

### Intuition

**fact** is a datum. It exists in the substrate.

**write** is a guarded transition. When predicate `φ` holds, the write function `W` determines what changes to make. The scope `s` is the authority — writes can only target locations within scope `s`. This is the action.

**observe** is a guarded perception. When predicate `φ` holds, the read function `R` produces an output. Observations never modify the substrate. This is the surface.

**∥** is parallel composition. Components exist side-by-side with no ordering. This is the reef.

**scope** is an authority boundary. Expressions within `scope(s, e)` have write authority over scope `s` and read authority over the entire substrate.

### Why Five Forms

Each is necessary:

- Without **fact**, there is no state.
- Without **write**, state cannot change.
- Without **observe**, state cannot be perceived.
- Without **∥**, components cannot coexist.
- Without **scope**, there are no authority boundaries.

Remove any one and a core substrate property vanishes.

---

## 4. Reduction Rules

The Σ-calculus has two reduction rules. This is the complete dynamics.

### Rule 1: Activation (write)

```
         φ(Σ) = true      W(Σ) = {(s₁,k₁,v₁), ..., (sₙ,kₙ,vₙ)}
         ∀i. sᵢ ∈ authority(e)
    ─────────────────────────────────────────────────────────────────
    Σ ; write(φ, s, W) ∥ E  ⟶  Σ[s₁/k₁ ↦ v₁]...[sₙ/kₙ ↦ vₙ] ; E
```

When the predicate is satisfied and all writes fall within the authority of the enclosing scope, the write applies atomically. The write term is consumed (single-fire) or remains (persistent) depending on the variant — we distinguish these below.

### Rule 2: Observation

```
         φ(Σ) = true      R(Σ) = o
    ──────────────────────────────────────
    Σ ; observe(φ, s, R) ∥ E  ⟶  Σ ; observe(φ, s, R) ∥ E  ⊢ o
```

Observations produce output but do not modify the substrate. The observer persists. Output `o` is emitted to the environment.

### Non-determinism

When multiple writes have satisfied predicates simultaneously, the calculus does not specify an order. Any enabled write may fire. This is the formal expression of opportunistic activation — the system is nondeterministic in scheduling but deterministic in each individual step.

### Persistence Variants

We distinguish two kinds of writes:

- **Impulse**: `write!(φ, s, W)` — fires once when `φ` becomes true, then is consumed.
- **Standing**: `write*(φ, s, W)` — fires every time `φ` is true and remains in the system.

And two kinds of observations:

- **Continuous**: `observe*(φ, s, R)` — produces output whenever `φ` holds.
- **Triggered**: `observe!(φ, s, R)` — produces output on the transition from `¬φ` to `φ`.

In sync, actions are standing writes (they persist across invocations). Surfaces are continuous observations. Timers with delete effects are impulse writes.

---

## 5. Derived Concepts

Several concepts from the substrate thesis are derivable from the five primitives rather than being primitive themselves.

### Actions

A sync action is:

```
scope(registrar, write*(φ_if ∧ φ_enabled, registrar, W_template))
```

An action is a standing write, scoped to its registrar's authority, guarded by the conjunction of its precondition (`if`) and its availability (`enabled`), applying a write template.

### Surfaces

A sync surface is:

```
observe*(φ_enabled, display_scope, R_render)
```

A surface is a continuous observation with an enabled predicate and a render function.

### Views

A sync view is:

```
observe*(⊤, view_scope, R_project)
```

A view is an always-active observation that projects private state into a scoped output. The scope boundary controls who can read the projection.

### Capability Delegation

The most architecturally interesting derived concept. When Bob invokes an action registered by Alice:

```
scope(alice, write*(φ, alice, W))
```

The write executes with Alice's authority regardless of who triggered it. The scope boundary carries the authority. This is capability delegation: Alice creates a bounded capability (the write within her scope), and anyone who can invoke the action exercises that capability.

In the calculus, this is simply the scoping rule applied to writes. No special mechanism is needed. Authority is structural.

---

## 6. Algebraic Laws

These are the properties the Σ-calculus satisfies. Each corresponds to a key architectural claim of the substrate thesis and should be provable in Lean.

### Law 1: Commutativity of Composition

```
e₁ ∥ e₂  ≡  e₂ ∥ e₁
```

Parallel composition is order-independent. There is no "first" component. This is the formal expression of "no orchestration."

### Law 2: Associativity of Composition

```
(e₁ ∥ e₂) ∥ e₃  ≡  e₁ ∥ (e₂ ∥ e₃)
```

Composition is flat. Nesting is irrelevant. The reef has no hierarchical structure at the composition level.

### Law 3: Identity of Composition

```
e ∥ ∅  ≡  e
```

The empty system is the identity. Adding nothing changes nothing.

*Laws 1–3 establish that (System, ∥, ∅) is a commutative monoid.*

### Law 4: Observer Independence

```
Σ ; observe(φ, s, R) ∥ E  ⟶*  Σ' ; E'
    implies
Σ ; E  ⟶*  Σ' ; E'
```

Removing an observer does not change the substrate's evolution. Observers are pure — they perceive but do not affect. This is the formal guarantee that adding a surface cannot break existing behavior.

### Law 5: Scope Isolation

```
scope(s₁, write(φ, s₁, W₁)) ∥ scope(s₂, write(φ, s₂, W₂))
    where s₁ ≠ s₂
    implies W₁ and W₂ write to disjoint locations
```

Writes in different scopes cannot conflict. Scope boundaries guarantee write isolation. This is the structural basis of authority.

### Law 6: Monotonic Confluence

```
If write(φ₁, s, W₁) and write(φ₂, s, W₂) are both monotonic
(they only add facts, never overwrite or delete),
then applying them in either order produces the same substrate.
```

```
W₁(W₂(Σ)) = W₂(W₁(Σ))
```

Monotonic writes commute. This is CALM expressed as an algebraic law. It is the formal reason substrates can scale without coordination — as long as writes only accumulate facts.

### Law 7: Non-Monotonic Serialization

```
If write(φ, s, W) is non-monotonic (it overwrites or deletes),
then the final substrate depends on application order.
```

```
∃ Σ, W₁, W₂:  W₁(W₂(Σ)) ≠ W₂(W₁(Σ))
```

Non-monotonic writes do not commute. They require serialization — a coordination mechanism that establishes order. This is where "organs" appear: bounded regions of serialized, non-monotonic computation surrounded by a monotonic substrate.

*Laws 6 and 7 together formalize the boundary between substrate (monotonic, coordination-free) and organ (non-monotonic, serialized).*

---

## 7. Key Theorems

These are the propositions to prove in Lean. They represent the core claims of the substrate thesis expressed as formal statements.

### Theorem 1: Compositional Safety

*Adding an observer to a system does not change the set of reachable substrate states.*

```
reachable(Σ₀, E) = reachable(Σ₀, E ∥ observe(φ, s, R))
```

This is the formal version of "new surfaces can be added without modifying existing ones." It follows directly from observer independence (Law 4).

### Theorem 2: Monotonic Confluence

*A system containing only monotonic writes is confluent: regardless of firing order, the same set of facts is eventually established.*

```
If all writes in E are monotonic, then:
∀ execution orders π₁, π₂:
    terminal(Σ₀, E, π₁) = terminal(Σ₀, E, π₂)
```

This is CALM applied to substrate systems. It guarantees that monotonic substrates converge regardless of scheduling nondeterminism.

### Theorem 3: Scope Authority

*A write within scope s can only modify locations in scope s.*

```
If  Σ ; scope(s, write(φ, s, W)) ∥ E  ⟶  Σ' ; E'
then  ∀ (s', k) where s' ≠ s:  Σ'(s', k) = Σ(s', k)
```

Scope boundaries are inviolable. This is the formal basis for capability delegation — Alice's scope cannot be modified except through actions she has explicitly registered.

### Theorem 4: Activation Determinism

*Given a substrate state, the set of activated components is deterministic, even though the order of their execution is not.*

```
activated(Σ, E) = { e ∈ E | guard(e)(Σ) = true }
```

The *what* is determined. The *when* is not. This captures the essential character of opportunistic systems: predictable relevance, nondeterministic scheduling.

### Theorem 5: Organ Encapsulation

*If a non-monotonic write is enclosed in a scope, and the scope emits only monotonic facts to the outer substrate, then the outer substrate remains confluent.*

```
If  scope(s, E_non_mono)  only adds facts to outer scopes
then  the outer system satisfies Theorem 2
```

This formalizes the organ pattern: localized non-monotonic computation that emits monotonic results. The organ handles serialization internally; the reef remains coordination-free. The boundary between organ and substrate is the monotonicity boundary.

---

## 8. Expressiveness

### What the Σ-calculus can express

- **Blackboard systems**: Knowledge sources are standing writes. The blackboard is the substrate. Self-activation is predicate guards.
- **Tuple spaces**: `out` is a write. `rd` is an observation. `in` is a non-monotonic write (read-and-delete) — which correctly requires an organ.
- **ECA rules**: `ON event IF condition DO action` is `write!(φ_condition, s, W_action)` — an impulse write.
- **Reactive UI**: Components are continuous observers. State changes trigger re-observation. Virtual DOM diffing is an optimization of continuous observation.
- **Multi-agent coordination**: Agents are external processes that read the substrate (observe) and invoke writes. The wait-condition-then-act loop is: observe the substrate until a predicate holds, then apply a write.

### What the Σ-calculus cannot express

- **Sequential composition**: There is no "then." Ordering must be encoded in predicates (e.g., "phase = 2" guards a write that only makes sense after "phase = 1" is established by another write). This is intentional — the calculus models emergence, not sequence.
- **Recursive computation**: There is no self-reference in terms. A write cannot invoke another write. Recursive patterns must be encoded as chains of predicate-guarded writes that fire in sequence as each establishes the conditions for the next. This is equivalent to tail recursion through state.
- **Continuous time**: The calculus is discrete. Each step produces a new substrate. Continuous-time behaviors must be approximated through timed impulse writes.

These limitations are features. The Σ-calculus captures exactly the dynamics of substrate systems and nothing more. Sequential composition and recursion are the domain of the λ-calculus. The Σ-calculus is not a replacement — it is a complement, modeling the emergent dimension that λ-calculus does not address.

---

## 9. Toward Lean

The formalization strategy for Lean 4:

### Phase 1: Core Types

```lean
-- Located keys and substrates
structure Loc where
  scope : String
  key : String

def Substrate := Loc → Option Val

-- Predicates as decidable propositions
def Pred := Substrate → Bool

-- Write and read functions
def WriteFn := Substrate → List (Loc × Val)
def ReadFn := Substrate → Out
```

### Phase 2: Terms

```lean
inductive Term where
  | fact : String → String → Val → Term
  | write : Pred → String → WriteFn → Term
  | observe : Pred → String → ReadFn → Term
  | par : Term → Term → Term
  | scope : String → Term → Term
```

### Phase 3: Reduction

```lean
inductive Step : Substrate → Term → Substrate → Term → Prop where
  | activate_write : 
      φ Σ = true → 
      W Σ = writes → 
      all_in_scope s writes →
      Step Σ (Term.write φ s W) (apply_writes Σ writes) Term.empty
  | observe_emit :
      φ Σ = true →
      R Σ = output →
      Step Σ (Term.observe φ s R) Σ (Term.observe φ s R)
  | par_left :
      Step Σ e₁ Σ' e₁' →
      Step Σ (Term.par e₁ e₂) Σ' (Term.par e₁' e₂)
  | par_right :
      Step Σ e₂ Σ' e₂' →
      Step Σ (Term.par e₁ e₂) Σ' (Term.par e₁ e₂')
```

### Phase 4: Theorems

```lean
theorem compositional_safety :
  reachable Σ₀ E S ↔ reachable Σ₀ (Term.par E (Term.observe φ s R)) S

theorem monotonic_confluence :
  all_monotonic E → 
  terminal Σ₀ E π₁ = terminal Σ₀ E π₂

theorem scope_authority :
  Step Σ (Term.scope s (Term.write φ s W)) Σ' e' →
  ∀ loc, loc.scope ≠ s → Σ' loc = Σ loc
```

### Phase 5: Organ Encapsulation

```lean
theorem organ_encapsulation :
  non_monotonic_internally E_organ →
  monotonic_externally E_organ →
  all_monotonic E_outer →
  confluent (Term.par (Term.scope s E_organ) E_outer)
```

---

## 10. Relationship to Existing Calculi

| Calculus | Models | Composition | Reduction |
|---|---|---|---|
| **λ-calculus** | Sequential computation | Function application | β-reduction |
| **π-calculus** | Mobile processes | Channel passing | Communication |
| **ambient calculus** | Nested boundaries | Boundary crossing | in/out/open |
| **Σ-calculus** | Emergent systems | Parallel observation | Activation |

The λ-calculus asks: what can be computed by applying functions?

The π-calculus asks: what can be computed by communicating processes?

The Σ-calculus asks: **what can emerge from self-activating observers of shared truth?**

These are complementary questions. A complete computational model may require all three: λ for sequential logic, π for communication, Σ for emergence. The substrate thesis claims that the third question has been systematically under-formalized, and that the Σ-calculus is a first attempt at giving it the same algebraic treatment the other two have received.

---

*February 2026 · Edinburgh*
