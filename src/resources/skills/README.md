# Skills Resources — Authoring Guide

This directory ships LLM agent skills for the `mcp-google-map` MCP server. Skills are inert instruction assets: no runtime module under `src/` imports them, so adding a skill never requires source-code changes, rebuilds, or test changes.

## Layout contract

```
src/resources/skills/
├── manifest.json              # machine-readable registry of all skills
├── README.md                  # this authoring guide
└── <skill-id>/                # exactly one skill per directory
    └── SKILL.md               # the skill (English, self-contained)
```

## SKILL.md format (Agent Skills compatible: pi, OpenClaw, and similar hosts)

- UTF-8 Markdown file starting with YAML front matter delimited by `---` lines.
- Front matter fields:
  - `name`: 1–64 characters, lowercase ASCII letters, digits, hyphens; no leading, trailing, or consecutive hyphens; MUST match the containing directory name.
  - `description`: non-empty, ≤ 1024 characters; states the capability and the triggering tasks, with important routing cues first.
- Body: operative instructions in English, self-contained, ≤ ~500 lines. Support files (if ever needed) go under canonical subdirectories (`scripts/`, `references/`, `assets/`, `images/`); `SKILL.md` stays the only file at the skill root.
- Skills that operate on Google Maps data MUST obtain every data value through the mcp-google-map tools listed in `PRJ-001` of `usereq/docs/REQUIREMENTS.md` and MUST forbid fabricated or simulated data presented as API-verified.

## Adding a new skill

1. Create `src/resources/skills/<skill-id>/SKILL.md` following the format above.
2. Append one entry to `manifest.json` (`id`, `name`, `version`, `language`, `path`, `description`, optional `adaptedFrom`). Keep `name` equal to `id` and `path` relative to this directory.
3. Commit both changes together. No other project file needs to change.

## Registry entry schema

| Field | Required | Description |
|---|---|---|
| `id` | yes | Stable skill identifier; equal to `name` and the directory name. |
| `name` | yes | Agent Skills front-matter name; must match `id`. |
| `version` | yes | Semantic version of the skill (skill-local, independent of package version). |
| `language` | yes | ISO language code of the skill body (`en` by policy). |
| `path` | yes | Path of `SKILL.md` relative to this directory. |
| `description` | yes | Short routing summary; consistent with the front-matter `description`. |
| `adaptedFrom` | no | Provenance note when the skill derives from an external source document. |
