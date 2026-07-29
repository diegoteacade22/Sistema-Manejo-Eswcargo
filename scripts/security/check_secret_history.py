#!/usr/bin/env python3
"""Fail when reachable Git history contains known credential risks."""

from __future__ import annotations

import re
import subprocess
import sys


FORBIDDEN_PATHS = {
    ".env.production",
    "DEPLOYMENT_GUIDE.md",
    "DEPLOY_QUICK.md",
    "GEMINI_API_KEY_CONFIG.md",
    "GEMINI_API_RESUMEN.md",
    "webapp/check_remote_users.ts",
    "webapp/prisma/bulk_enable_clients.ts",
    "webapp/prisma/client_credentials_2026-02-13.csv",
    "webapp/prisma/create_admin_new.ts",
    "webapp/prisma/reset_admin.ts",
    "webapp/setup_users.ts",
}
SECRET_NAMES = (
    "AUTH_SECRET",
    "SMTP_PASS",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "AGENT_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
)
PLACEHOLDERS = {
    "",
    "pass",
    "password",
    "user_password",
    "your_password",
    "your-password",
    "change_me",
    "changeme",
    "replace_me",
    "example",
    "***removed***",
}
POSTGRES_URI = re.compile(r"(?i)postgres(?:ql)?://[^:/\s'\"]+:([^@\s'\"]+)@")
GOOGLE_KEY = re.compile(r"\bAIza[0-9A-Za-z_-]{30,45}\b")
SECRET_ASSIGNMENT = re.compile(
    rf"(?im)^\s*(?:{'|'.join(SECRET_NAMES)})\s*=\s*([^\r\n#]*)"
)


def git(*args: str, text: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        check=True,
        text=text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def is_placeholder(value: str) -> bool:
    clean = value.strip().strip("'\"").strip()
    lower = clean.lower()
    if lower in PLACEHOLDERS:
        return True
    if clean.startswith(("$", "<", "{{")):
        return True
    if any(token in clean for token in ("process.env", "os.getenv", "getenv(")):
        return True
    return lower == clean and clean.replace("_", "").isalpha() and lower in PLACEHOLDERS


def main() -> int:
    commits = git("rev-list", "--all", "HEAD").stdout.splitlines()
    violations: set[str] = set()
    checked_blobs: set[str] = set()

    for commit in commits:
        for entry in git("ls-tree", "-r", commit).stdout.splitlines():
            metadata, path = entry.split("\t", 1)
            oid = metadata.split()[2]
            if path in FORBIDDEN_PATHS:
                violations.add(f"{commit[:12]} contains forbidden path {path}")
                continue
            if oid in checked_blobs:
                continue
            checked_blobs.add(oid)
            body = git("cat-file", "blob", oid, text=False).stdout
            if len(body) > 2_000_000:
                continue
            text = body.decode("utf-8", "ignore")
            if GOOGLE_KEY.search(text):
                violations.add(f"{commit[:12]} contains a Google API key in {path}")
            if "-----BEGIN PRIVATE KEY-----" in text:
                violations.add(f"{commit[:12]} contains a private key in {path}")
            for match in POSTGRES_URI.finditer(text):
                if not is_placeholder(match.group(1)):
                    violations.add(
                        f"{commit[:12]} contains embedded database credentials in {path}"
                    )
            for match in SECRET_ASSIGNMENT.finditer(text):
                if not is_placeholder(match.group(1)):
                    violations.add(
                        f"{commit[:12]} contains a non-placeholder secret in {path}"
                    )

    if violations:
        print("SECURITY CHECK FAILED: reachable history contains credential risks.")
        for violation in sorted(violations):
            print(f"- {violation}")
        return 1

    print(
        f"Security history check passed: {len(commits)} commits and "
        f"{len(checked_blobs)} unique blobs reviewed."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
