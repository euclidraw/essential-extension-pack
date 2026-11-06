# alid extension pack template

Create a public repository using this template and enter its `owner/repo` in alid's GitHub installer. This template contains a working sticky-note example under `extensions/example`; replace its code and IDs before publishing your own pack.

`alid.extension.json` lists up to 20 members in installation order. A `{ "path": "extensions/example" }` member refers to a folder in this repository, pinned to the pack commit. Each folder has its own `alid.extension.json` and built bundle. A string such as `"owner/repo"` refers to a separate public extension repository, resolved to its own default-branch commit. Mix both forms; put dependency providers first. Nested packs and duplicate locations or extension IDs are rejected.

alid verifies every manifest and bundle before presenting the source and asking for trust. Installation is sequential: if a member fails, previously installed members remain. Members are managed and removed individually. Reinspect and approve the pack to update its members.

The example is copied from [alid-extension-template](https://github.com/jiwonMe/alid-extension-template); see its README for build and development instructions. It is not an essential extension.
