"""Versioned, bounded passive transport shared with Django's runner client."""
import hashlib
import hmac
import json
import re

VERSION = "pi-runner-v1"
PATH = "/v1/command"
HEALTH_PATH = '/v1/status'
PORT = 8123
MAX_REQUEST = 12 * 1024 * 1024
MAX_RESPONSE = 13 * 1024 * 1024
MAX_RECORD = 4 * 1024 * 1024
IDENTITY = ("operationId", "ownerId", "conversationId", "epoch", "generation", "seq")
COMMANDS = {"create", "prompt", "abort", "state", "dispose", "skills", "ack", "gateway_response"}


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate_key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))


def signature(key, stamp, nonce, raw, direction="request", path=PATH):
    return hmac.new(key, "\n".join([VERSION, direction, "POST", path, stamp, nonce, hashlib.sha256(raw).hexdigest()]).encode(), hashlib.sha256).hexdigest()


def validate_command(value):
    if not isinstance(value, dict) or set(value) != {*IDENTITY, "command", "payload"}:
        raise ValueError("invalid_command")
    if (not isinstance(value['ownerId'], str) or not 1 <= len(value['ownerId']) <= 320
            or any(ord(c) < 33 or ord(c) > 126 for c in value['ownerId'])):
        raise ValueError('invalid_owner')
    for key in ["operationId", "conversationId"]:
        if not isinstance(value[key], str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value[key]):
            raise ValueError("invalid_identity")
    for key in ["epoch", "generation", "seq"]:
        if type(value[key]) is not int or not 1 <= value[key] <= 9007199254740991:
            raise ValueError("invalid_fence")
    if value["command"] not in COMMANDS or not isinstance(value["payload"], dict) or len(encode(value)) > MAX_REQUEST:
        raise ValueError("invalid_command")
    return value


def workspace_key(value):
    return hashlib.sha256(encode({key: value[key] for key in ["ownerId", "conversationId", "epoch", "generation"]})).hexdigest()


def validate_manifest(value):
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "version", "skills"} or value['schemaVersion'] != 1 or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',value["version"]):
        raise ValueError("invalid_skill_manifest")
    ids, paths = set(), set()
    for skill in value["skills"]:
        if not isinstance(skill, dict) or set(skill) != {"id", "version", "sha256", "resources"}:
            raise ValueError("invalid_skill")
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", skill["id"]) or skill["id"].lower() in ids or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',skill["version"]):
            raise ValueError("skill_collision")
        ids.add(skill["id"].lower())
        if not re.fullmatch(r"[a-f0-9]{64}", skill["sha256"]) or not isinstance(skill["resources"], list):
            raise ValueError("invalid_skill_hash")
        for resource in skill["resources"]:
            if not isinstance(resource, dict) or set(resource) != {"path", "sha256", "sizeBytes"}:
                raise ValueError("invalid_skill_resource")
            path = resource["path"]
            if (not isinstance(path, str) or not re.fullmatch(r"[A-Za-z0-9_./-]{1,180}", path)
                    or path.startswith("/") or any(p in {"", ".", ".."} for p in path.split("/"))
                    or path.lower().endswith(("agents.md", "claude.md")) or (skill['id']+'/'+path).lower() in paths
                    or not re.fullmatch(r"[a-f0-9]{64}", resource["sha256"])
                    or type(resource["sizeBytes"]) is not int or not 1 <= resource["sizeBytes"] <= 262144):
                raise ValueError("unsafe_skill_resource")
            paths.add((skill["id"] + "/" + path).lower())
        if not any(r["path"] == "SKILL.md" for r in skill["resources"]):
            raise ValueError("skill_instructions_required")
        digest = hashlib.sha256(encode(skill["resources"])).hexdigest()
        if digest != skill["sha256"]:
            raise ValueError("skill_digest_mismatch")
    if len(ids) != 3:
        raise ValueError("skill_set_mismatch")
    return value
