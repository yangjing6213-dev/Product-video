# Security Policy

## Supported scope

This project is an early local MVP. Security fixes target the current maintained code after a report has been verified. No public stable-release support matrix or response-time commitment is currently published.

## Reporting a vulnerability

Do not publish vulnerability details, proof-of-concept material, credentials, tokens, private data, or other secrets in a public issue, discussion, pull request, log, or screenshot.

No verified private security-reporting channel is currently documented for this project. If you cannot contact the maintainers through a verified private channel, keep the sensitive details private until the maintainers publish one. Do not send secrets merely to demonstrate an issue.

When a private channel becomes available, provide only the minimum information needed to reproduce the problem:

- affected version or commit;
- operating system and relevant local tool versions;
- expected and observed behavior;
- minimal reproduction steps with all sensitive values removed;
- impact and any safe mitigation already tested.

For ordinary bugs, documentation problems, and feature requests that do not contain security-sensitive information, use the Issue tracker of the verified public repository once it is available.

## Local safety

Keep API keys and credentials outside the repository. Do not commit `.env` files, browser profiles, user data, private inputs, generated local tools, or audit reports. If a secret may have been exposed, revoke or rotate it through the provider before sharing a redacted report.

Third-party dependencies, models, fonts, and media retain their own security and licensing conditions. Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and project asset notices before redistribution.

## Known dependency advisory

The pinned `adm-zip` dependency is affected by GHSA-vwc7-r8mq-g2x9. The current application-path assessment and exact reviewed versions are documented in [DEPENDENCY-RISK.md](docs/security/DEPENDENCY-RISK.md). The local consistency check is not a runtime sandbox or a vulnerability fix, and a successful check must not be reported as a clean `npm audit` result.
