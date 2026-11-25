#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
mkdir -p "$home/layouts" "$home/themes" "$home/mods"
cp "$here/layouts/herdrtw.json" "$home/layouts/"
cp "$here/themes/herdrtw.json" "$home/themes/"
rm -rf "$home/mods/.herdrtw.new"
cp -R "$here/mods/herdrtw" "$home/mods/.herdrtw.new"
for keep in bg.json inherit.json scripts.json; do
  [ -f "$home/mods/herdrtw/$keep" ] && cp "$home/mods/herdrtw/$keep" "$home/mods/.herdrtw.new/$keep"
done
rm -rf "$home/mods/herdrtw"
mv "$home/mods/.herdrtw.new" "$home/mods/herdrtw"
rm -rf "$home/mods/.goto.new"
cp -R "$here/mods/goto" "$home/mods/.goto.new"
rm -rf "$home/mods/goto"
mv "$home/mods/.goto.new" "$home/mods/goto"
merge='
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
ours = json.load(open(src))
theirs = json.load(open(dst)) if os.path.exists(dst) else {}
added = 0
for section, keys in ours.items():
    have = theirs.setdefault(section, {})
    for key, action in keys.items():
        if key not in have:
            have[key] = action
            added += 1
if added:
    with open(dst + ".tmp", "w") as f:
        json.dump(theirs, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(dst + ".tmp", dst)
print("keys: %d added" % added)
'
if command -v python3 >/dev/null 2>&1; then
  python3 -c "$merge" "$here/keys.json" "$home/keys.json"
else
  echo "python3 not found: add the \"layout:herdrtw\" section of $here/keys.json to $home/keys.json yourself."
fi
herdr-app check "$home/mods/herdrtw"
herdr-app check "$home/mods/goto"
echo "Installed. Switch with: herdr-app do layout.switch '{\"name\":\"herdrtw\"}'"
