# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. The
integration stores nothing in `/data`: its configuration (the address of Home
Assistant and the long-lived access token, kept as a secret by Gladys) comes
from Gladys at every start. It talks to Gladys and to the Home Assistant
address typed by the user, over its WebSocket API, and never logs the token.
A long-lived token gives the rights of its Home Assistant user: the
integration only reads the states and registries and calls the services the
user asks for (device commands, scene actions); the commands of locks, garage
doors and gates stay off unless the user allows them.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Home Assistant and the devices it controls.
