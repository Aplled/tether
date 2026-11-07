# Runtime security checkpoint — November 7, 2026

The initial system runtime was Node 26.3.1. It predates the October security updates and is a historical test baseline, not the selected runtime for the final checkpoint.

The [October 21 Node advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) includes fixes for Brotli memory corruption, DNS and TLS identity handling, HTTP behavior, and other runtime issues. These are outside the npm dependency audit. The selected replacement is [Node 26.13.0 LTS](https://nodejs.org/en/blog/release/v26.13.0), whose release notes say its code matches patched 26.12.1 apart from LTS metadata.

## Installation boundary

The project bootstrap downloads the official macOS archive into ignored `.runtime/toolchains`, verifies it against a pinned SHA-256 from the official release, and runs it through `scripts/dev.sh`. It does not replace global Node, modify Homebrew, change shell startup files, upgrade macOS, or alter Flowstate. No downloaded runtime binary or private demo state belongs in Git.

The pinned official archive digests are:

| Platform | SHA-256 |
| --- | --- |
| macOS arm64 | `d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6` |
| macOS x64 | `525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e` |

This is an HTTPS download checked against a pinned release digest. Do not describe it as independent OpenPGP signature verification unless that separate check has actually run.

## Verification

The final handoff records the actual binary version and clean-install/test/demo results. The intended commands are:

```sh
runtime_node="$(./scripts/bootstrap-runtime.sh)"
"$runtime_node" --version
./scripts/dev.sh ci --ignore-scripts
./scripts/dev.sh run typecheck
./scripts/dev.sh test
./scripts/dev.sh run mcp:smoke
./scripts/dev.sh run agent:demo
./scripts/dev.sh run demo
```

Passing `npm audit` checks reported package advisories; it neither audits the Node executable nor proves application security.

## Already announced follow-up

Node has [announced security releases for November 11](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases), with high-severity issues affecting the 26.x line. Those future fixes are not available at this November 7 checkpoint. Recheck the official release when published, update the runtime pin and digest, and rerun the suite before any real-data or public deployment. The prototype remains local and synthetic; selecting the latest available LTS is not a promise that no undisclosed vulnerabilities remain.
