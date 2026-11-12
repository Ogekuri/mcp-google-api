# Skills Resources — Authoring Guide

This repository ships LLM agent skills for the `mcp-google-api` MCP server. Skills are inert instruction assets: no runtime module under `src/` imports them, so adding a skill never requires source-code changes, rebuilds, or test changes. This guide lives under `docs/` and is therefore never part of the published npm package (PKG-038).

## Layout contract

```
docs/SKILLS_AUTHORING.md        # this authoring guide (repository-only, not packed)
src/resources/skills/
├── manifest.json              # machine-readable registry of all skills
└── <skill-id>/                # exactly one skill per directory
    ├── SKILL.md               # the skill (English, self-contained)
    └── DEBUG.md               # optional debug overlay (never part of SKILL.md)
```

The published package ships only `src/resources/skills/manifest.json` and the `<skill-id>/` content files (PKG-024, PKG-075); no other file may live at the skills root.

Debug instructions are never embedded in `SKILL.md`. A skill that needs a debug section ships it in a dedicated overlay file declared by the manifest `debug` field; `mcp-google-api install` copies content files only and appends the overlay to the installed `SKILL.md` solely when `--debug-skills` is passed. The default install therefore produces a skill with no debug instructions.

## SKILL.md format (Agent Skills compatible: pi, OpenClaw, and similar hosts)

- UTF-8 Markdown file starting with YAML front matter delimited by `---` lines.
- Front matter fields:
  - `name`: 1–64 characters, lowercase ASCII letters, digits, hyphens; no leading, trailing, or consecutive hyphens; MUST match the containing directory name.
  - `description`: non-empty, ≤ 1024 characters; states the capability and the triggering tasks, with important routing cues first.
- Body: operative instructions in English, self-contained, ≤ ~500 lines. Support files (if ever needed) go under canonical subdirectories (`scripts/`, `references/`, `assets/`, `images/`); `SKILL.md` stays the only file at the skill root.
- Skills that operate on Google Maps data MUST obtain every data value through the mcp-google-api tools listed in `PRJ-001` of `usereq/docs/REQUIREMENTS.md` and MUST forbid fabricated or simulated data presented as API-verified.

## Adding a new skill

1. Create `src/resources/skills/<skill-id>/SKILL.md` following the format above.
2. Optional: create `src/resources/skills/<skill-id>/DEBUG.md` holding every debug instruction, and declare it as `"debug": "DEBUG.md"` in the manifest entry. Keep `SKILL.md` free of debug instructions.
3. Append one entry to `manifest.json` (`id`, `name`, `version`, `language`, `path`, `description`, optional `debug`, optional `adaptedFrom`). Keep `name` equal to `id`, `path` relative to `src/resources/skills/`, and `debug` relative to the skill directory.
4. Commit both changes together. No other project file needs to change.

## Registry entry schema

| Field | Required | Description |
|---|---|---|
| `id` | yes | Stable skill identifier; equal to `name` and the directory name. |
| `name` | yes | Agent Skills front-matter name; must match `id`. |
| `version` | yes | Semantic version of the skill (skill-local, independent of package version). |
| `language` | yes | ISO language code of the skill body (`en` by policy). |
| `path` | yes | Path of `SKILL.md` relative to `src/resources/skills/`. |
| `description` | yes | Short routing summary; consistent with the front-matter `description`. |
| `debug` | no | Debug overlay path relative to the skill directory (convention: `DEBUG.md`); appended to the installed `SKILL.md` only with `install --debug-skills`. |
| `adaptedFrom` | no | Provenance note when the skill derives from an external source document. |
