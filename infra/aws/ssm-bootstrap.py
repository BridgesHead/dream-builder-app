#!/usr/bin/env python3
"""Runs server/bootstrap.sh on the Dream Builder servers through SSM (no SSH needed).

Run in CloudShell next to kit.tgz, made from the repo with:  tar -czf kit.tgz -C infra server
    python3 ssm-bootstrap.py            # both servers
    python3 ssm-bootstrap.py staging    # just one
"""
import base64
import json
import os
import subprocess
import sys
import time

ECR = "010834800857.dkr.ecr.ap-south-1.amazonaws.com/dreambuilder-backend"
REGISTRY = ECR.split("/")[0]
TARGETS = {"staging": "i-0bd3b0c3c9230134a", "prod": "i-0670e3aa9833ddc69"}
KIT = os.path.expanduser(os.environ.get("KIT", "~/kit.tgz"))


def aws(*args):
    return subprocess.run(["aws", *args], capture_output=True, text=True)


def main():
    envs = sys.argv[1:] or list(TARGETS)
    b64 = base64.b64encode(open(KIT, "rb").read()).decode()
    failed = False
    for env in envs:
        iid = TARGETS[env]
        cmds = [
            "set -e",
            "rm -rf /root/dreambuilder-kit && mkdir -p /root/dreambuilder-kit",
            f"echo {b64} | base64 -d | tar -xz -C /root/dreambuilder-kit",
            f"bash /root/dreambuilder-kit/server/bootstrap.sh {env} {ECR} > /root/dreambuilder-bootstrap.log 2>&1 || (tail -40 /root/dreambuilder-bootstrap.log; exit 1)",
            "tail -5 /root/dreambuilder-bootstrap.log",
            f"echo {REGISTRY} | docker-credential-ecr-login get > /dev/null && echo ECR_AUTH_OK",
            "docker compose version",
            "swapon --show --noheadings || true",
            "ls -l /opt/dreambuilder",
        ]
        r = aws("ssm", "send-command", "--instance-ids", iid,
                "--document-name", "AWS-RunShellScript",
                "--comment", f"dreambuilder bootstrap {env}",
                "--timeout-seconds", "900",
                "--parameters", json.dumps({"commands": cmds}),
                "--query", "Command.CommandId", "--output", "text")
        if r.returncode != 0:
            print(f"[{env}] send-command failed: {r.stderr.strip()}")
            failed = True
            continue
        cmd_id = r.stdout.strip()
        print(f"[{env}] {iid} command {cmd_id}", flush=True)

        status, inv = "Pending", {}
        for _ in range(180):  # up to 15 minutes
            g = aws("ssm", "get-command-invocation", "--command-id", cmd_id,
                    "--instance-id", iid, "--output", "json")
            if g.returncode == 0:
                inv = json.loads(g.stdout)
                status = inv["Status"]
                if status not in ("Pending", "InProgress", "Delayed"):
                    break
            time.sleep(5)

        print(f"[{env}] status: {status}")
        print(inv.get("StandardOutputContent", "")[-1500:])
        err = inv.get("StandardErrorContent", "").strip()
        if err:
            print(f"[{env}] stderr (tail):\n{err[-600:]}")
        failed |= status != "Success"
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
