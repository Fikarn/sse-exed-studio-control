#!/usr/bin/env bash
# PROBE (the throwaway branch probe/shell-xvfb-crash, never merged): runs the
# Setup/Support lane once in each variant, in an order that turns with the
# copy, and records how each run ended, with a backtrace of every core.
#   base      today's code
#   main      the watch's looks gathered on the main thread (the fix)
#   nohelper  the engine starts no pictures helper
set -u
copy="$1"
orders=("base main nohelper" "main nohelper base" "nohelper base main")
order="${orders[$(((copy - 1) % 3))]}"
mkdir -p probe-results
ulimit -c unlimited
for variant in $order; do
  case "$variant" in
    base) see=here helper=on ;;
    main) see=main helper=on ;;
    nohelper) see=here helper=off ;;
  esac
  rm -f /tmp/cores/core.* 2>/dev/null
  log="probe-results/copy$copy-$variant.log"
  started=$(date +%s)
  SSE_PROBE_SEE="$see" SSE_PROBE_HELPER="$helper" xvfb-run -a npm run tauri:setup-support:qualify > "$log" 2>&1
  code=$?
  ended=$(date +%s)
  early=$(grep -m1 -o "exited early during '[^']*'" "$log" || true)
  signature=$(grep -m1 -E "malloc\(\)|Gdk:ERROR|double free|corrupted|free\(\)|Segmentation|Bail out" "$log" | sed 's/"/'"'"'/g' | cut -c1-200 || true)
  cores=$(ls /tmp/cores/core.* 2>/dev/null | wc -l)
  echo "RESULT copy=$copy variant=$variant exit=$code seconds=$((ended - started)) cores=$cores early=\"$early\" signature=\"$signature\"" | tee -a probe-results/summary.txt
  for core in /tmp/cores/core.*; do
    [ -e "$core" ] || continue
    gdb -batch -ex "info threads" -ex "thread apply all bt 40" native/target/debug/sse-exed-tauri-shell "$core" \
      > "probe-results/copy$copy-$variant-$(basename "$core").bt.txt" 2>&1 || true
  done
done
exit 0
