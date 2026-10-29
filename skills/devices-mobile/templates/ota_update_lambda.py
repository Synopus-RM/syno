"""Self-hosted OTA update endpoint for @capgo/capacitor-updater (AWS Lambda, Python).

Deploy behind a Lambda Function URL or API Gateway (HTTPS) and set its URL as
`ota.updateUrl` in app-sync.json. The app POSTs its device info; this function
reads manifest.json (written by package_ota.py and uploaded by the OTA
workflow) and answers with the newer bundle, or a "no update" message.

Environment:
  OTA_BUCKET      S3 bucket holding <prefix>/manifest.json and <prefix>/<version>/bundle.zip
  OTA_PREFIX      e.g. "demo-desk"
  APP_ID          the app id, e.g. "in.synopus.desk" (requests for other ids are refused)

IAM: s3:GetObject on arn:aws:s3:::OTA_BUCKET/OTA_PREFIX/manifest.json
"""
import json
import os
import re

import boto3

s3 = boto3.client("s3")
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)")


def _v(s):
    m = SEMVER.match(str(s or ""))
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def _reply(body, status=200):
    return {"statusCode": status, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def _none(msg):
    # Both keys present = "no update"; the plugin logs the message and keeps the current bundle.
    return _reply({"message": msg, "error": "no_new_version_available"})


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except ValueError:
        return _reply({"message": "bad request", "error": "bad_request"}, 400)

    if body.get("app_id") != os.environ["APP_ID"]:
        return _none("unknown app")

    obj = s3.get_object(Bucket=os.environ["OTA_BUCKET"], Key=f"{os.environ['OTA_PREFIX']}/manifest.json")
    manifest = json.loads(obj["Body"].read())

    platform = str(body.get("platform", "")).lower()
    if platform not in manifest.get("platforms", []):
        return _none(f"no OTA channel for {platform}")

    # Never send web code to a native build older than the one it was made for.
    min_build = manifest.get("minNativeBuild")
    try:
        if min_build and int(body.get("version_build") or 0) < int(min_build):
            return _none("native update required from the store")
    except ValueError:
        pass

    current = body.get("version_name") or "0.0.0"
    if _v(manifest["version"]) <= _v(current):
        return _none("already up to date")

    return _reply({"version": manifest["version"], "url": manifest["url"], "checksum": manifest["checksum"]})
