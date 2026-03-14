# Namespace Doctrine

StarStory uses a layered naming model so the public product identity, archive model, and diegetic character can coexist without forcing broad internal renames.

## Canonical Meanings

- StarStory = platform
- Chronicle = archive
- Archivist = system role
- Meepo = archivist character and/or internal codename

## Practical Interpretation

Use **StarStory** when referring to the product, platform, web archive, public Discord root, or outward-facing user experience.

Use **Chronicle** when referring to the preserved campaign record, archive artifact, or long-lived campaign history.

Use **Archivist** when referring to the role the system plays in preserving, indexing, and recalling campaign history.

Use **Meepo** when referring to the in-world archivist character, lore-bound presentation, or compatibility/internal code paths that are not directly user-visible.

## Internal Naming Policy

Internal `meepo` identifiers may remain when they are not directly rendered to users. This includes module names, storage keys, env vars, database identifiers, compatibility exports, and operational tooling references.

The doctrine is presentation-first rather than rename-everything. If a reference is user-visible and describes the platform, it should use **StarStory**. If it is internal or lore-bound, it may remain **Meepo**.