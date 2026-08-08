# Generalization Decisions

Every architectural decision for the v0.8 generalization train. Format:

```markdown
## DEC-XXX: Title

**Status:** Accepted | Proposed | Rejected
**Reason:** Why the decision exists.
**Decision:** The concrete choice.
**Consequences:** What changes as a result.
```

## DEC-001: No silent fallback to an unrelated language

**Status:** Accepted
**Reason:** A wrong forced decoder language can cause severe recognition
errors; unknown or automatic profiles must never silently become Filipino.
**Decision:** Unknown or automatic profiles remain unconstrained rather
than falling back to Filipino. `auto` uses the session source mode; only
explicit profiles force a decoder language.
**Consequences:** Provider selection and UI must handle `auto` explicitly;
`sidecar.py::profile_source_mode` needs an explicit mapping table
(DS-101); multi-source Mandarin sources must reach Whisper with
`language="zh"`.
