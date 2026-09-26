#!/usr/bin/env bash
set -euo pipefail

platform="$1"
artifacts="$2"
previous_artifacts="${3:-}"
smoke_root="${RUNNER_TEMP}/local-expert-disk-release-smoke"
install_root="${smoke_root}/install"
mkdir -p "${install_root}"

if [[ "${CI:-}" != "true" ]]; then
  echo "release installation smoke is restricted to an isolated CI runner" >&2
  exit 1
fi
baseline_artifacts="${artifacts}"
if [[ -n "${previous_artifacts}" && -d "${previous_artifacts}" ]]; then
  baseline_artifacts="${previous_artifacts}"
fi

wait_for_database() {
  database="$1"
  process_id="$2"
  for _ in $(seq 1 60); do
    if [[ -f "${database}" ]] && cargo run -p release-smoke --locked -- probe "${database}" >/dev/null 2>&1; then
      kill "${process_id}" 2>/dev/null || true
      wait "${process_id}" 2>/dev/null || true
      return 0
    fi
    if ! kill -0 "${process_id}" 2>/dev/null; then
      wait "${process_id}"
      return 1
    fi
    sleep 1
  done
  kill "${process_id}" 2>/dev/null || true
  wait "${process_id}" 2>/dev/null || true
  echo "application did not create its SQLite database" >&2
  return 1
}

launch_and_wait() {
  executable="$1"
  database="$2"
  if [[ "${platform}" == "linux" ]]; then
    APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a "${executable}" &
  else
    "${executable}" &
  fi
  wait_for_database "${database}" "$!"
}

if [[ "${platform}" == "macos" ]]; then
  installed_app="${install_root}/Local Expert Disk.app"
  executable="${installed_app}/Contents/MacOS/desktop"
  database="/Users/${USER}/Library/Application Support/local.expertdisk.desktop/index.db"
  rm -f "${database}" "${database}-shm" "${database}-wal"
  install_dmg() {
    dmg="$1"
    mount_point="${smoke_root}/mounted"
    mkdir -p "${mount_point}"
    hdiutil attach "${dmg}" -nobrowse -readonly -mountpoint "${mount_point}"
    source_app=$(find "${mount_point}" -maxdepth 1 -name '*.app' -print -quit)
    [[ -n "${source_app}" ]]
    rm -rf "${installed_app}"
    ditto "${source_app}" "${installed_app}"
    hdiutil detach "${mount_point}"
  }
  first_dmg=$(find "${baseline_artifacts}" -maxdepth 1 -name '*.dmg' -print -quit)
  current_dmg=$(find "${artifacts}" -maxdepth 1 -name '*.dmg' -print -quit)
  [[ -n "${first_dmg}" && -n "${current_dmg}" ]]
  install_dmg "${first_dmg}"
  launch_and_wait "${executable}" "${database}"
  cargo run -p release-smoke --locked -- mark "${database}"
  install_dmg "${current_dmg}"
  launch_and_wait "${executable}" "${database}"
  cargo run -p release-smoke --locked -- verify "${database}"
elif [[ "${platform}" == "linux" ]]; then
  first_appimage=$(find "${baseline_artifacts}" -maxdepth 1 -name '*.AppImage' -print -quit)
  current_appimage=$(find "${artifacts}" -maxdepth 1 -name '*.AppImage' -print -quit)
  package=$(find "${artifacts}" -maxdepth 1 -name '*.deb' -print -quit)
  [[ -n "${first_appimage}" && -n "${current_appimage}" && -n "${package}" ]]
  dpkg-deb --info "${package}" >/dev/null
  installed_app="${install_root}/LocalExpertDisk.AppImage"
  cp "${first_appimage}" "${installed_app}"
  chmod +x "${installed_app}"
  export XDG_DATA_HOME="${smoke_root}/data"
  database="${XDG_DATA_HOME}/local.expertdisk.desktop/index.db"
  launch_and_wait "${installed_app}" "${database}"
  cargo run -p release-smoke --locked -- mark "${database}"
  cp "${current_appimage}" "${installed_app}"
  chmod +x "${installed_app}"
  launch_and_wait "${installed_app}" "${database}"
  cargo run -p release-smoke --locked -- verify "${database}"
else
  echo "unsupported smoke platform: ${platform}" >&2
  exit 1
fi
