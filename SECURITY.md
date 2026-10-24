# Security policy

CacheNook deletes files. Please treat a path-safety bug as a security issue.

## Supported versions

Only the latest release is supported with security fixes.

## Reporting

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting:

https://github.com/ethansara92-beep/cachenook/security/advisories/new

Include:

- macOS version
- CacheNook version
- A minimal reproduction, ideally with a temporary directory
- The exact path or IPC call involved

You will get an acknowledgement as soon as possible. Please do not publish details before a fix is available.

## Scope

In scope:

- Path traversal or symlink escape
- Deleting outside an allowlisted root
- IPC input validation bypasses
- LaunchAgent or launcher command injection
- Renderer code execution
- Sending file contents or unrelated data to an AI endpoint

Out of scope:

- Deleting files after the user confirms a preview, when the path is inside the allowlisted root
- Denial of service from scanning a very large folder
- Deleting personal files after the user selects them and confirms the Trash dialog
- The privacy of an AI endpoint the user chooses to configure
- Unsigned build warnings from Gatekeeper
