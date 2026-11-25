import json
import os
import re
import sys
import urllib.request

CONFIG = os.path.expanduser("~/.claude.json")
CACHE = os.path.expanduser("~/.cache/herdrtw/hub-links.json")
ACCEPT = "application/json, text/event-stream"


def server():
    with open(CONFIG) as handle:
        data = json.load(handle)
    stack = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if str(node.get("url", "")).startswith("https://hub.biztrip") and "headers" in node:
                return node["url"], node["headers"]
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    raise SystemExit("hub server not configured")


class Hub:
    def __init__(self):
        self.url, self.headers = server()
        self.session = None
        self.n = 0
        self.call("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "herdrtw", "version": "1"}})
        self.post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def post(self, body):
        headers = {**self.headers, "Content-Type": "application/json", "Accept": ACCEPT, "User-Agent": "herdrtw/1"}
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        req = urllib.request.Request(self.url, json.dumps(body).encode(), headers)
        with urllib.request.urlopen(req, timeout=30) as res:
            self.session = res.headers.get("Mcp-Session-Id") or self.session
            raw = res.read().decode()
            kind = res.headers.get("Content-Type", "")
        if not raw.strip():
            return None
        if "event-stream" in kind:
            raw = "".join(line[5:].strip() for line in raw.splitlines() if line.startswith("data:"))
        return json.loads(raw)

    def call(self, method, params):
        self.n += 1
        return self.post({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params})

    def issue(self, key):
        res = self.call("tools/call", {"name": "get-issue-tool", "arguments": {"key": key, "include_comments": False, "include_activities": False}})
        text = "".join(c.get("text", "") for c in res["result"]["content"])
        data = json.loads(text)
        return data.get("issue", data.get("data", data))


def summarize(issue):
    return {
        "type": issue.get("type"),
        "title": issue.get("title"),
        "links": [{"key": i["key"], "type": i.get("type"), "title": i.get("title")} for i in issue.get("linked_issues", [])],
    }


def main():
    keys = sorted({k.upper() for k in sys.argv[1:] if re.fullmatch(r"BA-\d+", k, re.I)})
    try:
        with open(CACHE) as handle:
            cache = json.load(handle)
    except (OSError, ValueError):
        cache = {}
    hub = Hub()
    for key in keys:
        try:
            cache[key] = summarize(hub.issue(key))
        except Exception as err:
            print(f"{key}: {err}", file=sys.stderr)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as handle:
        json.dump(cache, handle, indent=1)
    print(len(keys))


main()
