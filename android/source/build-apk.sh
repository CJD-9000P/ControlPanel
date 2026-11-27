#!/usr/bin/env bash
set -euo pipefail
project="$(cd "$(dirname "$0")" && pwd)"
: "${CJD_JDK:?Set CJD_JDK to the JDK directory}"
: "${CJD_ANDROID_JAR:?Set CJD_ANDROID_JAR to the Android platform jar}"
: "${CJD_BUILD_TOOLS:?Set CJD_BUILD_TOOLS to the SDK build-tools directory}"
: "${CJD_TEST_KEYSTORE:?Set CJD_TEST_KEYSTORE to a local debug keystore path}"
destination="${1:?Supply the destination APK path}"
export JAVA_HOME="$CJD_JDK"
export PATH="$JAVA_HOME/bin:$PATH"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
mkdir -p "$build/classes" "$build/dex"
sed 's/<manifest /<manifest package="es.cjd.panel" /; s/\${applicationId}/es.cjd.panel/g' \
    "$project/app/src/main/AndroidManifest.xml" > "$build/AndroidManifest.xml"
mapfile -t sources < <(find "$project/app/src/main/java" -name '*.java' | sort)
version_code="$(sed -nE 's/^[[:space:]]*versionCode ([0-9]+)$/\1/p' "$project/app/build.gradle")"
version_name="$(sed -nE "s/^[[:space:]]*versionName '([^']+)'$/\1/p" "$project/app/build.gradle")"
"$CJD_BUILD_TOOLS/aapt2" compile --dir "$project/app/src/main/res" -o "$build/resources.zip"
"$CJD_BUILD_TOOLS/aapt2" link -I "$CJD_ANDROID_JAR" --manifest "$build/AndroidManifest.xml" \
    --min-sdk-version 26 --target-sdk-version 34 --version-code "$version_code" --version-name "$version_name" \
    --java "$build/generated" -o "$build/uncompiled.apk" "$build/resources.zip"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -classpath "$CJD_ANDROID_JAR" \
    -d "$build/classes" "${sources[@]}" "$build/generated/es/cjd/panel/R.java"
jar cf "$build/classes.jar" -C "$build/classes" .
"$CJD_BUILD_TOOLS/d8" --release --lib "$CJD_ANDROID_JAR" --min-api 26 \
    --output "$build/dex" "$build/classes.jar"
jar uf "$build/uncompiled.apk" -C "$build/dex" classes.dex
"$CJD_BUILD_TOOLS/zipalign" -f 4 "$build/uncompiled.apk" "$build/aligned.apk"
if [[ ! -f "$CJD_TEST_KEYSTORE" ]]; then
    keytool -genkeypair -keystore "$CJD_TEST_KEYSTORE" -storepass android -keypass android \
        -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=CJD Development'
    chmod 600 "$CJD_TEST_KEYSTORE"
fi
"$CJD_BUILD_TOOLS/apksigner" sign --ks "$CJD_TEST_KEYSTORE" --ks-pass pass:android \
    --ks-key-alias androiddebugkey --out "$destination" "$build/aligned.apk"
"$CJD_BUILD_TOOLS/apksigner" verify --verbose "$destination"
"$CJD_BUILD_TOOLS/zipalign" -c 4 "$destination"
