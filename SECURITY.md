# Security policy

Nex Pi Control gives remote access to a server, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Mail [info@nex-ai.be](mailto:info@nex-ai.be) with the subject `SECURITY: nex-pi-control` and include:

- what you found and where (agent, admin shell or app, file and line if you have it);
- how to reproduce it;
- what an attacker could do with it.

We confirm receipt within 3 working days and keep you posted until it is fixed. With your permission we credit you in the release notes.

## Supported versions

Security fixes land on the latest release of the agent (`main`) and the latest version of the app on Google Play.

## Scope and design

The security model is described in [agent/README.md](agent/README.md#security-model). In short: loopback by default, bearer token on every request, optional Cloudflare Access, no sudo at runtime, polkit allowlist, read-only Docker proxy, admin shell off by default with an audit log.
