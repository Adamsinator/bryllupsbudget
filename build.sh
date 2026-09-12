#!/bin/sh
# Stempler index.html og version.json med samme build-tid. Kør før commit.
STAMP=$(date "+%Y-%m-%d %H:%M")
sed -i '' "s|<meta name=\"build\" content=\"[^\"]*\">|<meta name=\"build\" content=\"$STAMP\">|" index.html
printf '{ "build": "%s" }\n' "$STAMP" > version.json
echo "build $STAMP"
